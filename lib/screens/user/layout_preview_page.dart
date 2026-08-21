import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../brand.dart';
import '../../widgets.dart';

/// Stands the room a member's event is set up to up in 2D and 3D — the same
/// scene the Layout Designer desk draws with
/// (Admin/Layout Designer/js/scene3d.js), reused as-is by hosting a small
/// read-only page (hosting/layout-viewer) inside a WebView rather than
/// reimplementing a Three.js renderer natively.
///
/// The page is handed the plan rather than left to fetch it. This app has
/// already read `bookings/{id}` under the member's own session — that read is
/// what decided whether to offer this screen at all — so the layout is
/// already in memory, and passing it across costs one `runJavaScript` call.
///
/// That matters beyond tidiness. A WebView cannot inherit the app's native
/// Firebase Auth session, so a page that fetched for itself needed a
/// server-side token exchange to get one: a Cloud Function, and with it the
/// Blaze plan. Handing the data in removes both, and removes an ID token that
/// would otherwise travel through a URL — where it lands in browser history
/// and referrer headers. Firestore rules are untouched.
///
/// Read-only start to finish: nothing this screen or the page it loads can
/// write. Editing the plan stays the Layout Designer desk's job alone.
class LayoutPreviewPage extends StatefulWidget {
  const LayoutPreviewPage({
    super.key,
    required this.booking,
    required this.eventName,
  });

  /// The booking document as read by [BookingRepository] — the `layout` map
  /// and the few fields the walkthrough labels itself with.
  final Map<String, dynamic> booking;
  final String eventName;

  @override
  State<LayoutPreviewPage> createState() => _LayoutPreviewPageState();
}

class _LayoutPreviewPageState extends State<LayoutPreviewPage> {
  // Firebase Hosting's default domain for this project — see
  // lib/firebase_options.dart (projectId: hapagpamana-39687).
  static const _viewerBase =
      'https://hapagpamana-39687.web.app/layout-viewer/';

  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          // The plan goes in only once the page's own scripts have run —
          // window.HPViewer does not exist before that.
          onPageFinished: (_) {
            _send();
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (_) {
            if (mounted) {
              setState(() => _error = "Couldn't open the layout preview.");
            }
          },
        ),
      );
    _load();
  }

  Future<void> _load() async {
    // people=0 drops the crowd from the walkthrough on mobile. The animated
    // guests are heavy — skinned FBX bodies, one mesh each — and phones pay
    // for them in download, memory and frame rate for a preview that is
    // about the ROOM. The web viewer, on a desktop GPU, still gets them.
    // No booking id and no token: the plan is handed over by _send() below.
    final uri = Uri.parse(_viewerBase).replace(queryParameters: {
      'people': '0',
    });
    try {
      await _controller.loadRequest(uri);
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't open the layout preview.");
    }
  }

  /// Hands the page the plan. Only the fields the viewer actually reads are
  /// sent — the booking document also carries `Timestamp`s and other Firestore
  /// types that have no JSON form, and the preview has no business seeing the
  /// rest of a member's order anyway.
  ///
  /// Safe to call whenever [onPageFinished] decides to fire, including early
  /// and including twice, which Android's WebView does. The page installs
  /// `window.HPViewer` as a queueing stub in its `<head>` — before any
  /// network-fetched script — and `js/viewer.js` drains that queue when it
  /// loads, so a plan delivered ahead of the page's own scripts is held
  /// rather than thrown at an undefined object. Do not remove that stub
  /// believing this call is ordered after it; nothing guarantees that.
  ///
  /// The guard below matters because a JS exception raised here does NOT come
  /// back through [runJavaScript] as a Dart error — the `catch` would never
  /// fire and the failure would be invisible, which is precisely how this
  /// went wrong before.
  Future<void> _send() async {
    final b = widget.booking;
    final payload = <String, dynamic>{
      'layout': b['layout'],
      'occasion': b['occasion'] ?? b['eventName'] ?? widget.eventName,
      'pax': b['pax'] ?? b['headcount'],
      'eventType': b['eventType'],
    };
    // Encoded twice on purpose: once to JSON, then again to turn that JSON
    // into a correctly escaped JavaScript string literal to sit inside the
    // call. The page JSON.parses it back.
    final arg = jsonEncode(jsonEncode(payload));
    try {
      await _controller
          .runJavaScript('window.HPViewer && window.HPViewer.show($arg)');
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't open the layout preview.");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text(widget.eventName, style: AppTextStyles.heading),
      ),
      // The room takes a moment to build, so the scrim doesn't vanish the
      // instant the page reports itself finished — it fades off the WebView,
      // and an error fades in over it, rather than either one cutting.
      body: SmoothSwap(
        alignment: Alignment.center,
        child: _error != null
            ? _ErrorNotice(
                key: const ValueKey('preview-error'),
                message: _error!,
              )
            : Stack(
                key: const ValueKey('preview'),
                children: [
                  WebViewWidget(controller: _controller),
                  IgnorePointer(
                    ignoring: !_loading,
                    child: AnimatedOpacity(
                      opacity: _loading ? 1 : 0,
                      duration: Motion.base,
                      curve: Motion.exit,
                      child: const ColoredBox(
                        color: Colors.black12,
                        child: Center(child: CircularProgressIndicator()),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const ParchmentBackground(weave: true),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.screen),
            child: Text(
              message,
              style: AppTextStyles.body,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}
