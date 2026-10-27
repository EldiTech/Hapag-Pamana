import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/places_config.dart';
import '../../data/places_service.dart';
import '../../widgets.dart';

/// A full-screen address picker for the booking wizards' "address" and
/// "venue" questions: search-as-you-type suggestions from Google Places up
/// top, an embedded map with a draggable pin underneath so the member can
/// fine-tune the exact spot, and a bar pinned to the bottom confirming
/// whatever the pin currently sits on.
///
/// Pushed from a form's address/venue field instead of that field taking
/// typing directly — see `_pickAddress` / `_pickVenue`. Pops the chosen
/// [ResolvedAddress], or nothing if the member backs out. [title],
/// [searchHint], [fieldLabel] and [confirmLabel] let the same picker read as
/// either question rather than always saying "address".
class AddressPickerPage extends StatefulWidget {
  const AddressPickerPage({
    super.key,
    this.initialAddress,
    this.title = 'Choose your address',
    this.searchHint = 'Search for your address',
    this.fieldLabel = 'DELIVERY ADDRESS',
    this.confirmLabel = 'USE THIS ADDRESS',
  });

  /// The address already on the form, if any — reverse-searched so reopening
  /// the picker on an order already filled in doesn't start blank.
  final String? initialAddress;

  final String title;
  final String searchHint;
  final String fieldLabel;
  final String confirmLabel;

  @override
  State<AddressPickerPage> createState() => _AddressPickerPageState();
}

class _AddressPickerPageState extends State<AddressPickerPage> {
  final _searchCtrl = TextEditingController();
  final _mapCompleter = Completer<GoogleMapController>();

  Timer? _debounce;
  String _sessionToken = PlacesService.instance.newSessionToken();
  List<PlaceSuggestion> _suggestions = const [];
  bool _searching = false;

  LatLng _pin = const LatLng(PlacesConfig.defaultLat, PlacesConfig.defaultLng);
  String? _address;

  /// True while a drag or a suggestion tap is being resolved to an address —
  /// the confirm bar shows a spinner rather than a stale line while it waits.
  bool _resolving = false;

  @override
  void initState() {
    super.initState();
    _searchCtrl.text = widget.initialAddress ?? '';
    _address = widget.initialAddress?.trim().isEmpty ?? true
        ? null
        : widget.initialAddress!.trim();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    if (value.trim().isEmpty) {
      setState(() {
        _suggestions = const [];
        _searching = false;
      });
      return;
    }
    setState(() => _searching = true);
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final results =
          await PlacesService.instance.autocomplete(value, _sessionToken);
      if (!mounted) return;
      setState(() {
        _suggestions = results;
        _searching = false;
      });
    });
  }

  Future<void> _choose(PlaceSuggestion suggestion) async {
    setState(() {
      _suggestions = const [];
      _searchCtrl.text = suggestion.primaryText;
      _resolving = true;
    });
    FocusScope.of(context).unfocus();

    final resolved =
        await PlacesService.instance.details(suggestion.placeId, _sessionToken);
    // Spent — the next keystroke starts a new billed search.
    _sessionToken = PlacesService.instance.newSessionToken();
    if (!mounted) return;

    if (resolved == null) {
      setState(() => _resolving = false);
      return;
    }
    final target = LatLng(resolved.lat, resolved.lng);
    setState(() {
      _pin = target;
      _address = resolved.address;
      _resolving = false;
    });
    final controller = await _mapCompleter.future;
    await controller.animateCamera(CameraUpdate.newLatLngZoom(target, 17));
  }

  Future<void> _onPinDropped(LatLng target) async {
    setState(() {
      _pin = target;
      _resolving = true;
    });
    // Settles the camera on wherever the pin landed — a tap can drop it near
    // the viewport's edge, so this keeps the pin comfortably centered instead
    // of leaving the member to re-pan and find it.
    final controller = await _mapCompleter.future;
    unawaited(controller.animateCamera(CameraUpdate.newLatLng(target)));
    final address =
        await PlacesService.instance.reverseGeocode(target.latitude, target.longitude);
    if (!mounted) return;
    setState(() {
      _resolving = false;
      if (address != null) {
        _address = address;
        _searchCtrl.text = address;
      }
    });
  }

  void _confirm() {
    if (_address == null) return;
    Navigator.of(context).pop(
      ResolvedAddress(address: _address!, lat: _pin.latitude, lng: _pin.longitude),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text(widget.title, style: AppTextStyles.heading),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screen,
              AppSpacing.md,
              AppSpacing.screen,
              AppSpacing.sm,
            ),
            child: AppTextField(
              controller: _searchCtrl,
              hint: widget.searchHint,
              prefixIcon: Icons.search_rounded,
              suffixIcon: AnimatedSwitcher(
                duration: Motion.quick,
                switchInCurve: Motion.standard,
                switchOutCurve: Motion.exit,
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: ScaleTransition(scale: animation, child: child),
                ),
                child: _searching
                    ? const Padding(
                        key: ValueKey('spinner'),
                        padding: EdgeInsets.all(14),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : const SizedBox.shrink(key: ValueKey('empty')),
              ),
              onChanged: _onQueryChanged,
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                // The map stays mounted for the page's whole lifetime — its
                // GoogleMapController is captured once via [_mapCompleter],
                // so swapping this out from under a search result would
                // orphan that controller and leave `animateCamera` calling
                // into a disposed map. The suggestions list layers on top
                // instead of replacing it.
                Column(
                  children: [
                    Expanded(
                      child: Stack(
                        children: [
                          GoogleMap(
                            initialCameraPosition:
                                CameraPosition(target: _pin, zoom: 15),
                            onMapCreated: (c) {
                              if (!_mapCompleter.isCompleted) {
                                _mapCompleter.complete(c);
                              }
                            },
                            onTap: _onPinDropped,
                            markers: {
                              Marker(
                                markerId: const MarkerId('pin'),
                                position: _pin,
                                draggable: true,
                                onDragEnd: _onPinDropped,
                              ),
                            },
                            myLocationButtonEnabled: false,
                            zoomControlsEnabled: false,
                          ),
                          // Google's logo and "for development purposes only"
                          // watermark render in the map's bottom-left corner
                          // and must stay unobscured, so this sits well above
                          // it rather than flush with the map's bottom edge —
                          // and carries its own pill background since it's
                          // laid over live map tiles, not the parchment
                          // ground.
                          Positioned(
                            left: AppSpacing.md,
                            right: AppSpacing.md,
                            top: AppSpacing.md,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: AppSpacing.md,
                                vertical: AppSpacing.sm,
                              ),
                              decoration: BoxDecoration(
                                color: AppColors.surface.withValues(alpha: 0.92),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                'Tap the map or drag the pin to fine-tune the spot.',
                                textAlign: TextAlign.center,
                                style: AppTextStyles.sans(
                                  size: 11,
                                  color: AppColors.brownSoft,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _ConfirmBar(
                      address: _address,
                      busy: _resolving,
                      fieldLabel: widget.fieldLabel,
                      confirmLabel: widget.confirmLabel,
                      onConfirm: _address == null ? null : _confirm,
                    ),
                  ],
                ),
                Positioned.fill(
                  child: IgnorePointer(
                    ignoring: _suggestions.isEmpty,
                    child: AnimatedOpacity(
                      opacity: _suggestions.isEmpty ? 0 : 1,
                      duration: Motion.quick,
                      curve: Motion.standard,
                      child: ColoredBox(
                        color: AppColors.surface,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.screen,
                          ),
                          itemCount: _suggestions.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, i) {
                            final s = _suggestions[i];
                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.place_outlined),
                              title: Text(
                                s.primaryText,
                                style: AppTextStyles.sans(
                                  size: 13,
                                  weight: FontWeight.w700,
                                ),
                              ),
                              subtitle: s.secondaryText.isEmpty
                                  ? null
                                  : Text(
                                      s.secondaryText,
                                      style: AppTextStyles.bodySmall,
                                    ),
                              onTap: () => _choose(s),
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The bottom bar naming whatever address the pin currently sits on, with the
/// button that hands it back to the booking form.
class _ConfirmBar extends StatelessWidget {
  const _ConfirmBar({
    required this.address,
    required this.busy,
    required this.fieldLabel,
    required this.confirmLabel,
    required this.onConfirm,
  });

  final String? address;
  final bool busy;
  final String fieldLabel;
  final String confirmLabel;
  final VoidCallback? onConfirm;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screen,
          AppSpacing.md,
          AppSpacing.screen,
          AppSpacing.md,
        ),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.hairline)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(fieldLabel, style: AppTextStyles.eyebrow),
            const SizedBox(height: 4),
            AnimatedSwitcher(
              duration: Motion.quick,
              switchInCurve: Motion.standard,
              switchOutCurve: Motion.exit,
              transitionBuilder: (child, animation) => FadeTransition(
                opacity: animation,
                child: child,
              ),
              child: Text(
                busy ? 'Finding the address…' : (address ?? 'Pick a spot on the map'),
                key: ValueKey<String>(busy ? 'busy' : (address ?? 'empty')),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton.primary(
              label: confirmLabel,
              icon: Icons.check_rounded,
              fullWidth: true,
              busy: busy,
              onPressed: onConfirm,
            ),
          ],
        ),
      ),
    );
  }
}
