import 'package:flutter/material.dart';

/// Corner-radius scale — the curvature language of the app.
///
/// Soft, generous rounding reads as warm and premium. Cards use [lg], hero /
/// feature surfaces use [xl], inputs use [md], inner images use [sm], and
/// chips / pills use [pill]. Use the `*All` helpers to get a [BorderRadius]
/// directly.
class AppRadius {
  AppRadius._();

  static const double xs = 10;
  static const double sm = 12; // inner images
  static const double md = 14; // input fields
  static const double lg = 18; // standard cards
  static const double xl = 22; // hero / feature / banner cards
  static const double pill = 100; // chips & fully-rounded pills

  static BorderRadius get xsAll => BorderRadius.circular(xs);
  static BorderRadius get smAll => BorderRadius.circular(sm);
  static BorderRadius get mdAll => BorderRadius.circular(md);
  static BorderRadius get lgAll => BorderRadius.circular(lg);
  static BorderRadius get xlAll => BorderRadius.circular(xl);
  static BorderRadius get pillAll => BorderRadius.circular(pill);
}
