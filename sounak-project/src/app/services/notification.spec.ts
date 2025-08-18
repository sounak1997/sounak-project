import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar'; // Import MatSnackBar
import { NotificationService } from './notification';

describe('NotificationService', () => {
  let service: NotificationService;
  let snackBarSpy: jasmine.Spy; // Declare a spy for MatSnackBar

  // Create a mock object for MatSnackBar
  const mockMatSnackBar = {
    open: (message: string, action: string, config: any) => {}, // A dummy open method
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

    // Create a spy on the open method of the mockMatSnackBar
    snackBarSpy = spyOn(mockMatSnackBar, 'open');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should display a snackbar with the provided message and default action/duration', () => {
    const testMessage = 'Test notification message';

    service.displayNotification(testMessage);

    // Expect the snackBarSpy.open method to have been called
    expect(snackBarSpy).toHaveBeenCalled();
    // Expect it to have been called with the correct arguments
    expect(snackBarSpy).toHaveBeenCalledWith(testMessage, 'Dismiss', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  });

  it('should display a snackbar with custom action and duration', () => {
    const testMessage = 'Another test message';
    const testAction = 'Close';
    const testDuration = 5000;

    service.displayNotification(testMessage, testAction, testDuration);

    expect(snackBarSpy).toHaveBeenCalledWith(testMessage, testAction, {
      duration: testDuration,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  });
});