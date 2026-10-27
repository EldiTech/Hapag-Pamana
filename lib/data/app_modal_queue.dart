import 'dart:async';

/// Global FIFO coordinator for app-level popups (announcement bulletins,
/// resume-booking alerts, etc.) so that only ONE popup is visible at a time.
///
/// If multiple modals trigger simultaneously (e.g. on app launch), they
/// queue up in order and show sequentially once the active modal is closed.
class AppModalQueue {
  AppModalQueue._();
  static final AppModalQueue instance = AppModalQueue._();

  bool _isShowing = false;
  final List<Completer<void>> _queue = [];

  /// True while a modal is currently on-screen.
  bool get isShowing => _isShowing;

  /// Acquires the modal slot. If another modal is currently displayed,
  /// this pauses and waits until that modal is dismissed.
  Future<void> acquire() async {
    if (!_isShowing) {
      _isShowing = true;
      return;
    }
    final completer = Completer<void>();
    _queue.add(completer);
    await completer.future;
  }

  /// Releases the modal slot when a modal dismisses. If other modals are waiting,
  /// allows the next modal to present after a brief transition settle delay.
  void release() {
    if (_queue.isNotEmpty) {
      final next = _queue.removeAt(0);
      // Settle delay allows previous dialog route transition to finish cleanly
      Future.delayed(const Duration(milliseconds: 320), () {
        next.complete();
      });
    } else {
      _isShowing = false;
    }
  }

  /// Convenience wrapper to present any modal safely through the queue.
  Future<T?> show<T>(Future<T?> Function() showModal) async {
    await acquire();
    try {
      return await showModal();
    } finally {
      release();
    }
  }
}
