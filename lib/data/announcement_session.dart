/// Tracks whether an announcement popup has been displayed during the active user login session.
class AnnouncementSession {
  AnnouncementSession._();

  static final Set<String> _seenAnnouncementIds = <String>{};
  static bool _hasShownPopupThisSession = false;

  /// Resets session tracker (called on logout).
  static void reset() {
    _seenAnnouncementIds.clear();
    _hasShownPopupThisSession = false;
  }

  /// Mark when user logs in so announcements pop up for this login session.
  static void markLoggedIn() {
    _seenAnnouncementIds.clear();
    _hasShownPopupThisSession = false;
  }

  /// Returns true if popup has NOT been shown for this login session yet.
  static bool shouldShowForSession(List<String> currentIds) {
    if (_hasShownPopupThisSession) return false;
    if (currentIds.isEmpty) return false;
    _hasShownPopupThisSession = true;
    _seenAnnouncementIds.addAll(currentIds);
    return true;
  }

  /// Mark specific announcement as viewed.
  static void markViewed(String announcementId) {
    _seenAnnouncementIds.add(announcementId);
  }
}
