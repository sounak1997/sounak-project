"""
The agent loop — think, call a tool, look at the result, think again.

This is the whole idea in one file. Everything else (the registry, the manifest,
the HTTP client) is supporting cast.

    contents = [ ...history..., user message ]
    repeat up to N times:
        response = model(contents, tools=MENU)
        if response has no function calls:   -> that's the final answer, stop
        append the model's turn to contents
        for each function call:
            server  -> execute it now, real result
            client  -> record it for the browser, tell the model "ok"
            confirm -> record it as pending, tell the model "awaiting confirmation"
        append all the results as one turn
    (if we fall out of the loop, we hit the iteration cap)

WHY AUTOMATIC FUNCTION CALLING IS DISABLED
------------------------------------------
google-genai can execute tools for you if you hand it Python callables. That is
convenient and completely wrong here: it would run the loop inside the SDK,
where we can never intercept `navigate_to` to send it to the browser instead, or
hold `create_user` back for confirmation. Owning the loop is what makes the
client/confirm tool kinds possible.
"""
from google.genai import types

from app.config import settings
from app.retries import with_retries
from app.schemas import AgentAction, AgentResponse, AgentTurn, PendingAction, ToolTrace
from app.tools import manifest, registry
from app.tools.backend_api import BackendError
from app.tools.registry import ToolContext

AGENT_SYSTEM = """You are the in-app assistant for Sounak's application. You can \
read the app's live data and drive its user interface, using the tools provided.

HOW TO BEHAVE
- Prefer tools over guessing. For any question about real data — how many members, \
which products, what's in stock — call a tool. Never state a number you did not \
get from a tool.
- When the user asks to go somewhere, call navigate_to. Don't just describe the route.
- A "how do I..." question is an INSTRUCTION TO ACT, not a request for prose. You \
MUST call navigate_to for the relevant screen and highlight_element for each \
control involved, in the SAME turn as your explanation. Writing out the steps \
without calling those tools is a wrong answer, even if every word is correct. \
Never write "let's go there now" or "I'll take you there" unless you are \
actually emitting a navigate_to call in that same turn.
- Emit ALL the tool calls for a step together in ONE turn rather than one at a time. A walkthrough is navigate_to plus every highlight_element in the same turn — that is one round trip instead of five, and the user sees the whole tour at once.
- For questions about uploaded documents or written notes, call search_docs and \
cite the source filename.
- If a tool returns an error, read it and correct yourself — for example call \
list_products to get a real id rather than guessing one again.
- If a tool reports the session expired, tell the user to log in again. Do not \
invent data to cover the gap.
- Anything that changes data (create_user) is only ever a proposal: the user has \
to click Confirm. Say so plainly, and never invent a password.
- Keep replies short and conversational. Do not dump raw JSON at the user; \
summarise it in a sentence or a small list.

{manifest}
"""


def _build_system() -> str:
    return AGENT_SYSTEM.format(manifest=manifest.render_for_prompt())


def _to_contents(history: list[AgentTurn], message: str) -> list[types.Content]:
    """Replay the conversation the client sent, then append the new message."""
    contents: list[types.Content] = []
    for turn in history:
        if not turn.text.strip():
            continue
        # Gemini calls the assistant side "model", not "assistant".
        role = "model" if turn.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=turn.text)]))
    contents.append(types.Content(role="user", parts=[types.Part(text=message)]))
    return contents


def _is_degenerate(reply: str) -> bool:
    """
    True for a reply that is technically a response but useless to a human.

    Small models sometimes emit a single stray token ("_", "*", ".") instead of
    a summary after a tool call — finish_reason is STOP, the token count looks
    plausible, and nothing errors, so this slips through every other check and
    lands in the chat bubble as one character. Cheap to detect, so detect it.
    """
    stripped = reply.strip()
    # Nothing but punctuation/markdown noise ("_", "*", "...", "") is useless.
    # The test is "contains no letters or digits" rather than a length floor,
    # because "13" is a perfectly good answer to "how many members are there".
    return len(stripped) < 2 or not any(ch.isalnum() for ch in stripped)


def _answer_without_tools(client, contents, nudge: str | None = None):
    """
    Ask for a plain-language answer with the tool menu withheld.

    With no tools to reach for, the model can only reply in words, and it writes
    from the tool results already sitting in `contents`. Used both when the loop
    hits its iteration cap and when a reply comes back degenerate.
    """
    if nudge:
        contents = contents + [types.Content(role="user", parts=[types.Part(text=nudge)])]
    return with_retries(
        lambda: client.models.generate_content(
            model=settings.agent_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=_build_system(),
                max_output_tokens=settings.agent_max_tokens,
            ),
        ),
        max_retries=settings.max_retries,
        base_delay=settings.retry_base_delay,
        total_budget=settings.agent_retry_budget,
    )


SUMMARY_NUDGE = (
    "Now write the answer for the user in plain language, using the tool results "
    "above. Reply with normal prose — never a single character or symbol."
)


def _short(result: dict) -> str:
    """A one-line summary of a tool result, for the UI's trace panel."""
    if "error" in result:
        return str(result["error"])[:140]
    for key in ("total", "total_matching", "found", "navigated_to", "highlighted", "opened", "status"):
        if key in result:
            return f"{key}={result[key]}"
    return "ok"


def run_agent(client, request, store) -> AgentResponse:
    """
    Drive the loop to a final answer.

    `client` is the raw genai.Client (GeminiClient._client) — the agent needs
    the low-level generate_content because it manages `contents` itself.
    """
    ctx = ToolContext(auth_token=request.auth_token, store=store)
    contents = _to_contents(request.history, request.message)

    actions: list[AgentAction] = []
    pending: list[PendingAction] = []
    trace: list[ToolTrace] = []
    input_tokens = output_tokens = thinking_tokens = 0
    iterations = 0

    config = types.GenerateContentConfig(
        system_instruction=_build_system(),
        tools=[registry.gemini_tool()],
        max_output_tokens=settings.agent_max_tokens,
        # See the module docstring: we run the loop, not the SDK.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    for _ in range(settings.agent_max_iterations):
        iterations += 1

        response = with_retries(
            lambda: client.models.generate_content(
                model=settings.agent_model, contents=contents, config=config
            ),
            max_retries=settings.max_retries,
            base_delay=settings.retry_base_delay,
            total_budget=settings.agent_retry_budget,
        )

        usage = response.usage_metadata
        if usage:
            input_tokens += usage.prompt_token_count or 0
            output_tokens += usage.candidates_token_count or 0
            thinking_tokens += getattr(usage, "thoughts_token_count", 0) or 0

        calls = response.function_calls or []

        # No tool calls means the model is done thinking and this is the answer.
        if not calls:
            reply = (response.text or "").strip()

            # The tools may have all succeeded and still left us with junk like
            # "_". Ask once more, explicitly, with the tool menu withheld.
            if _is_degenerate(reply) and trace:
                try:
                    retry = _answer_without_tools(client, contents, SUMMARY_NUDGE)
                    if retry.usage_metadata:
                        input_tokens += retry.usage_metadata.prompt_token_count or 0
                        output_tokens += retry.usage_metadata.candidates_token_count or 0
                        thinking_tokens += getattr(
                            retry.usage_metadata, "thoughts_token_count", 0) or 0
                    retried = (retry.text or "").strip()
                    if not _is_degenerate(retried):
                        reply = retried
                except Exception:
                    pass  # keep whatever we had; the fallback below still applies

            if _is_degenerate(reply):
                # Say what actually happened rather than showing a stray token.
                # An empty reply here is usually MAX_TOKENS: the output budget is
                # shared with hidden thinking tokens, so raise AGENT_MAX_TOKENS.
                reply = (
                    "I fetched the data but couldn't put the summary into words. "
                    "Try asking again, or more specifically."
                    if trace
                    else "I couldn't put together a reply for that — try rephrasing?"
                )

            return AgentResponse(
                reply=reply, actions=actions, pending=pending, trace=trace,
                iterations=iterations, model=settings.agent_model,
                input_tokens=input_tokens, output_tokens=output_tokens,
                thinking_tokens=thinking_tokens,
            )

        # Record the model's turn verbatim — the function_call parts must be in
        # the history or the follow-up responses have nothing to attach to.
        if response.candidates and response.candidates[0].content:
            contents.append(response.candidates[0].content)

        result_parts: list[types.Part] = []
        for call in calls:
            name = call.name or ""
            args = dict(call.args or {})
            tool = registry.BY_NAME.get(name)

            if tool is None:
                result = {"error": f"Unknown tool '{name}'."}
                trace.append(ToolTrace(tool=name, kind="unknown", args=args, ok=False,
                                       detail="unknown tool"))
            elif tool.kind == "confirm":
                # A write. Propose it; do not touch the database.
                pending.append(PendingAction(
                    tool=name, args=args, label=tool.confirm_label or name,
                    summary=tool.summarise(args) if tool.summarise else name,
                ))
                result = {
                    "status": "awaiting_user_confirmation",
                    "note": "Nothing has been changed yet. Tell the user to click Confirm.",
                }
                trace.append(ToolTrace(tool=name, kind="confirm", args=args, ok=True,
                                       detail="awaiting confirmation"))
            else:
                try:
                    result = tool.run(args, ctx)
                except BackendError as e:
                    result = {"error": str(e), "status_code": e.status}
                except Exception as e:  # a broken tool must not kill the turn
                    result = {"error": f"Tool '{name}' failed: {e}"}

                ok = "error" not in result
                # A client tool that validated cleanly becomes a browser action.
                if tool.kind == "client" and ok:
                    actions.append(AgentAction(type=name, params=args))
                trace.append(ToolTrace(tool=name, kind=tool.kind, args=args, ok=ok,
                                       detail=_short(result)))

            result_parts.append(
                types.Part.from_function_response(name=name, response=result)
            )

        contents.append(types.Content(role="user", parts=result_parts))

    # Fell out of the loop still wanting to call tools. Do NOT return a canned
    # apology here: by this point the tools have usually all succeeded, and the
    # browser is about to navigate and highlight exactly as asked. Telling the
    # user "I couldn't do that" while the UI visibly does it is the worst of
    # both worlds.
    #
    # Instead, ask once more with the tool menu withheld. With no tools to reach
    # for, the model can only reply in words, and it writes its summary from the
    # tool results already sitting in `contents`.
    try:
        final = _answer_without_tools(client, contents, SUMMARY_NUDGE)
        if final.usage_metadata:
            input_tokens += final.usage_metadata.prompt_token_count or 0
            output_tokens += final.usage_metadata.candidates_token_count or 0
            thinking_tokens += getattr(final.usage_metadata, "thoughts_token_count", 0) or 0
        reply = (final.text or "").strip()
        if _is_degenerate(reply):
            reply = ""
    except Exception:
        reply = ""

    if not reply:
        # Genuinely nothing to say. Only now is an apology honest — and even
        # then, mention what did happen if anything did.
        reply = (
            "I ran out of steps before I could summarise that."
            if not trace
            else "I did what you asked, but ran out of steps before summarising it."
        )

    return AgentResponse(
        reply=reply,
        actions=actions, pending=pending, trace=trace, iterations=iterations,
        model=settings.agent_model, input_tokens=input_tokens,
        output_tokens=output_tokens, thinking_tokens=thinking_tokens,
    )


def run_confirmed(request, store) -> tuple[bool, str, list[AgentAction], list[ToolTrace]]:
    """
    Execute a write the user just approved.

    Deliberately does NOT go back to the model: the user already saw exactly what
    would happen and agreed to it, so re-asking an LLM could only introduce drift
    (or cost). The allowlist check is the security boundary — only tools declared
    `confirm` can ever arrive here.
    """
    name = request.tool
    if name not in registry.CONFIRMABLE:
        return False, f"'{name}' is not a confirmable action.", [], []

    tool = registry.BY_NAME[name]
    ctx = ToolContext(auth_token=request.auth_token, store=store)

    try:
        result = tool.run(dict(request.args or {}), ctx)
    except BackendError as e:
        return False, str(e), [], [
            ToolTrace(tool=name, kind="confirm", args=request.args, ok=False, detail=str(e))
        ]
    except Exception as e:
        return False, f"That failed: {e}", [], [
            ToolTrace(tool=name, kind="confirm", args=request.args, ok=False, detail=str(e))
        ]

    if "error" in result:
        return False, str(result["error"]), [], [
            ToolTrace(tool=name, kind="confirm", args=request.args, ok=False,
                      detail=str(result["error"]))
        ]

    trace = [ToolTrace(tool=name, kind="confirm", args=request.args, ok=True, detail="done")]

    if name == "create_user":
        created = result.get("created", {})
        return (
            True,
            f"Created {created.get('name', 'the member')} ({created.get('email', '')}).",
            [AgentAction(type="navigate_to", params={"route": "/user-list"})],
            trace,
        )

    return True, "Done.", [], trace
