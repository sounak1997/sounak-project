"""
The app's self-description: every screen, what it's for, and the elements the
assistant is allowed to point at.

WHY THIS EXISTS
---------------
RAG answers questions about *documents*. It cannot answer "where is the button
to add a user", because that fact lives in the Angular templates, not in any
document. So we hand the model a small, hand-maintained map of the UI and inject
it into the system prompt. It's tiny (~1-2KB) — far cheaper than a retrieval
round trip, and it never goes stale silently the way an ingested doc does,
because it sits next to the code it describes.

KEEPING IT HONEST
-----------------
`ai_id` values must match `data-ai-id="..."` attributes in the Angular
templates. If you rename or remove one there, fix it here too — otherwise the
assistant will confidently try to highlight something that doesn't exist (the
UiActionService degrades gracefully, but the guidance will be wrong).
"""

# route      — the Angular router path, exactly as registered in app.routes.ts
# title      — what a human calls the screen
# does       — one line; this is what the model matches user intent against
# auth       — True if the route sits behind authGuard
# elements   — the pointable bits: {ai_id, label}
SCREENS: list[dict] = [
    {
        "route": "/dashboard",
        "title": "Dashboard",
        "does": "Landing page after login; overview of the app.",
        "auth": True,
        "elements": [],
    },
    {
        "route": "/add-user",
        "title": "Add User",
        "does": "Create a new member/user by filling in name, email and password.",
        "auth": True,
        "elements": [
            {"ai_id": "add-user-name", "label": "Name field"},
            {"ai_id": "add-user-email", "label": "Email field"},
            {"ai_id": "add-user-password", "label": "Password field"},
            {"ai_id": "add-user-submit", "label": "Save / Add User button"},
        ],
    },
    {
        "route": "/user-list",
        "title": "User List",
        "does": "Browse every registered member. Backed by NgRx store.",
        "auth": True,
        "elements": [{"ai_id": "user-list-table", "label": "The list of members"}],
    },
    {
        "route": "/products",
        "title": "Products",
        "does": "Browse the product catalogue (name, price, category, stock).",
        "auth": True,
        "elements": [{"ai_id": "product-list-table", "label": "The product table"}],
    },
    {
        "route": "/signal-products",
        "title": "Signal Products",
        "does": "The same products, rendered through an NgRx Signal Store — a demo of Angular signals.",
        "auth": True,
        "elements": [],
    },
    {
        "route": "/signal-demo",
        "title": "Signals Demo",
        "does": "A counter demo showing how Angular signals propagate changes.",
        "auth": False,
        "elements": [],
    },
    {
        "route": "/notifications",
        "title": "Live Notifications",
        "does": "Real-time notification feed streamed over Server-Sent Events (SSE).",
        "auth": True,
        "elements": [],
    },
    {
        "route": "/chat",
        "title": "Live Chat",
        "does": "Real-time chat between users over a Socket.IO WebSocket.",
        "auth": True,
        "elements": [],
    },
    {
        "route": "/ai",
        "title": "AI Assistant (Gemini + RAG)",
        "does": (
            "Ask Gemini anything, or search your own uploaded documents. "
            "Upload/remove documents from the 'My documents' panel behind the folder icon."
        ),
        "auth": True,
        "elements": [
            {"ai_id": "ai-docs-toggle", "label": "My documents panel (folder icon)"},
            {"ai_id": "ai-mode-toggle", "label": "Chat / Search-my-docs switch"},
        ],
    },
    {
        "route": "/assistant",
        "title": "App Assistant",
        "does": (
            "This assistant. It can look up live data from the app and drive the "
            "UI for you — you are talking to it right now."
        ),
        "auth": True,
        "elements": [],
    },
]

# Panels that aren't routes but can still be opened by name.
PANELS: list[dict] = [
    {
        "name": "documents",
        "on_route": "/ai",
        "does": "The 'My documents' library where RAG source files are uploaded and removed.",
    },
]


def render_for_prompt() -> str:
    """Flatten the manifest into compact text for the system instruction."""
    lines = ["SCREENS IN THIS APP:"]
    for screen in SCREENS:
        guard = " (login required)" if screen["auth"] else ""
        lines.append(f"- {screen['route']} — {screen['title']}{guard}: {screen['does']}")
        for element in screen["elements"]:
            lines.append(f"    * ai_id \"{element['ai_id']}\" = {element['label']}")

    lines.append("")
    lines.append("PANELS (open with open_panel):")
    for panel in PANELS:
        lines.append(f"- \"{panel['name']}\" on {panel['on_route']}: {panel['does']}")
    return "\n".join(lines)


def known_routes() -> set[str]:
    return {s["route"] for s in SCREENS}


def known_ai_ids() -> set[str]:
    return {e["ai_id"] for s in SCREENS for e in s["elements"]}


def known_panels() -> set[str]:
    return {p["name"] for p in PANELS}
