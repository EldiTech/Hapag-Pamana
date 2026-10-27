import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'places_config.dart';

/// Talks to Google's Places API (New) and the Geocoding API for the address
/// picker (`address_picker_page.dart`): Places Autocomplete, so typing a few
/// letters offers real addresses instead of a blank the member has to get
/// exactly right; Place Details, resolving a tapped suggestion to a full
/// address and coordinates; and Geocoding, so a pin dropped or dragged on the
/// map resolves back to a formatted address the same way a typed one would.
///
/// A process-wide singleton, mirroring [PayMongoService].
class PlacesService {
  PlacesService._();
  static final PlacesService instance = PlacesService._();
  factory PlacesService() => instance;

  static const String _placesBase = 'https://places.googleapis.com/v1';
  static const String _geocodeBase = 'https://maps.googleapis.com/maps/api';
  static const Duration _timeout = Duration(seconds: 12);

  /// Ties every autocomplete call in one typing session to the same token, so
  /// Google bills the session as one search rather than one request per
  /// keystroke. A fresh token starts on the first keystroke after the field
  /// was empty or a suggestion was picked — see [AddressPickerPage].
  String newSessionToken() {
    final rand = Random.secure();
    return List.generate(24, (_) => rand.nextInt(16).toRadixString(16)).join();
  }

  /// Up to five place suggestions for [input], biased toward the Philippines
  /// since that's the whole of the business's delivery area. Empty on a blank
  /// query or anything Google couldn't complete — an autocomplete field that
  /// occasionally shows nothing is expected; one that throws mid-keystroke is
  /// not, so failures are swallowed here rather than surfaced.
  Future<List<PlaceSuggestion>> autocomplete(
    String input,
    String sessionToken,
  ) async {
    final query = input.trim();
    if (query.isEmpty) return const [];

    final uri = Uri.parse('$_placesBase/places:autocomplete');

    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': PlacesConfig.apiKey,
            },
            body: jsonEncode({
              'input': query,
              'sessionToken': sessionToken,
              'includedRegionCodes': ['ph'],
            }),
          )
          .timeout(_timeout);
      if (res.statusCode != 200) return const [];
      final json = jsonDecode(res.body);
      if (json is! Map) return const [];
      final suggestions = json['suggestions'];
      if (suggestions is! List) return const [];
      return [
        for (final s in suggestions)
          if (s is Map && s['placePrediction'] is Map)
            PlaceSuggestion.fromJson(s['placePrediction'] as Map),
      ];
    } catch (_) {
      return const [];
    }
  }

  /// The full address and coordinates behind [placeId] — what a tapped
  /// suggestion resolves to before it lands on the map and the form field.
  Future<ResolvedAddress?> details(String placeId, String sessionToken) async {
    final uri = Uri.parse('$_placesBase/places/$placeId');

    try {
      final res = await http.get(
        uri,
        headers: {
          'X-Goog-Api-Key': PlacesConfig.apiKey,
          'X-Goog-FieldMask': 'formattedAddress,location',
        },
      ).timeout(_timeout);
      if (res.statusCode != 200) return null;
      final json = jsonDecode(res.body);
      if (json is! Map) return null;
      return _resolvedFrom(json);
    } catch (_) {
      return null;
    }
  }

  /// The formatted address at [lat]/[lng] — used when the member drags the
  /// pin rather than searches, so the text field still ends up with a real
  /// address rather than bare coordinates.
  Future<String?> reverseGeocode(double lat, double lng) async {
    final uri = Uri.parse('$_geocodeBase/geocode/json').replace(
      queryParameters: {
        'latlng': '$lat,$lng',
        'key': PlacesConfig.apiKey,
      },
    );

    try {
      final res = await http.get(uri).timeout(_timeout);
      final json = jsonDecode(res.body);
      if (json is! Map || json['status'] != 'OK') return null;
      final results = json['results'];
      if (results is! List || results.isEmpty) return null;
      final first = results.first;
      if (first is! Map) return null;
      final address = first['formatted_address'];
      return address is String && address.isNotEmpty ? address : null;
    } catch (_) {
      return null;
    }
  }

  static ResolvedAddress? _resolvedFrom(Map result) {
    final address = result['formattedAddress'];
    final location = result['location'];
    final lat = location is Map ? location['latitude'] : null;
    final lng = location is Map ? location['longitude'] : null;
    if (address is! String || lat is! num || lng is! num) return null;
    return ResolvedAddress(
      address: address,
      lat: lat.toDouble(),
      lng: lng.toDouble(),
    );
  }
}

/// One row in the autocomplete dropdown.
class PlaceSuggestion {
  const PlaceSuggestion({
    required this.placeId,
    required this.primaryText,
    required this.secondaryText,
  });

  final String placeId;

  /// The bold headline Google suggests showing ("SM Mall of Asia").
  final String primaryText;

  /// The quieter rest of the address ("Seaside Blvd, Pasay, Metro Manila").
  final String secondaryText;

  factory PlaceSuggestion.fromJson(Map json) {
    final structured = json['structuredFormat'];
    final s = structured is Map ? structured : const {};
    final mainText = s['mainText'];
    final secondaryText = s['secondaryText'];
    final text = json['text'];
    return PlaceSuggestion(
      placeId: (json['placeId'] ?? '').toString(),
      primaryText: ((mainText is Map ? mainText['text'] : null) ??
              (text is Map ? text['text'] : null) ??
              '')
          .toString(),
      secondaryText:
          ((secondaryText is Map ? secondaryText['text'] : null) ?? '')
              .toString(),
    );
  }
}

/// An address resolved to a point — from a tapped suggestion or a dragged
/// pin, either way what the picker hands back to the booking form.
class ResolvedAddress {
  const ResolvedAddress({
    required this.address,
    required this.lat,
    required this.lng,
  });

  final String address;
  final double lat;
  final double lng;
}
