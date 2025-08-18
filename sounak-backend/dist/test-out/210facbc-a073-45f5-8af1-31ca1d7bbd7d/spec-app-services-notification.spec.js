import {
  MatSnackBar,
  NotificationService,
  init_notification,
  init_snack_bar
} from "./chunk-CDXDGVIB.js";
import {
  TestBed,
  init_testing
} from "./chunk-TYTEZKBC.js";
import "./chunk-TTULUY32.js";

// src/app/services/notification.spec.ts
init_testing();
init_snack_bar();
init_notification();
describe("NotificationService", () => {
  let service;
  let snackBarSpy;
  const mockMatSnackBar = {
    open: (message, action, config) => {
    }
    // A dummy open method
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        // Provide the mock MatSnackBar instead of the real one
        { provide: MatSnackBar, useValue: mockMatSnackBar }
      ]
    });
    service = TestBed.inject(NotificationService);
    snackBarSpy = spyOn(mockMatSnackBar, "open");
  });
  it("should be created", () => {
    expect(service).toBeTruthy();
  });
  it("should display a snackbar with the provided message and default action/duration", () => {
    const testMessage = "Test notification message";
    service.displayNotification(testMessage);
    expect(snackBarSpy).toHaveBeenCalled();
    expect(snackBarSpy).toHaveBeenCalledWith(testMessage, "Dismiss", {
      duration: 3e3,
      horizontalPosition: "center",
      verticalPosition: "bottom"
    });
  });
  it("should display a snackbar with custom action and duration", () => {
    const testMessage = "Another test message";
    const testAction = "Close";
    const testDuration = 5e3;
    service.displayNotification(testMessage, testAction, testDuration);
    expect(snackBarSpy).toHaveBeenCalledWith(testMessage, testAction, {
      duration: testDuration,
      horizontalPosition: "center",
      verticalPosition: "bottom"
    });
  });
});
//# sourceMappingURL=spec-app-services-notification.spec.js.map
