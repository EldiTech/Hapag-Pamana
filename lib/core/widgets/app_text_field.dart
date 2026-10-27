import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_spacing.dart';
import '../theme/app_text_styles.dart';

/// A labelled text field — the form primitive for the whole app.
///
/// Consolidates the near-identical "label + `SizedBox` + `TextField`" blocks
/// that lived on the login screen (`_Label`) and the catering inquiry form
/// (`_Field` / `_DateField`). The field's *look* comes from
/// [AppTheme.inputDecorationTheme]; this widget only adds the label row and the
/// common knobs (icons, obscure, multiline, read-only date pickers, …).
///
/// When [errorText] appears (or changes), the field plays a brief horizontal
/// shake with a light haptic tick, so a failed validation is felt as well as
/// read — every form in the app gets this for free.
///
/// Pass a null [label] to render just the field (e.g. the menu search box).
class AppTextField extends StatefulWidget {
  const AppTextField({
    super.key,
    this.label,
    this.hint,
    this.controller,
    this.prefixIcon,
    this.suffixIcon,
    this.errorText,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.maxLines = 1,
    this.readOnly = false,
    this.onTap,
    this.onChanged,
    this.autofillHints,
    this.inputFormatters,
  });

  final String? label;
  final String? hint;
  final TextEditingController? controller;

  /// A leading icon (rendered at size 20 to match the field metrics).
  final IconData? prefixIcon;

  /// An arbitrary trailing widget (e.g. a visibility toggle or calendar icon).
  final Widget? suffixIcon;

  /// Inline validation message shown beneath the field; null hides it. Styled
  /// by [AppTheme.inputDecorationTheme].
  final String? errorText;

  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final int maxLines;
  final bool readOnly;
  final VoidCallback? onTap;
  final ValueChanged<String>? onChanged;
  final Iterable<String>? autofillHints;

  /// Keystroke-level guards (digits only, length caps, …) so a field can refuse
  /// characters it will never accept rather than complain about them later.
  final List<TextInputFormatter>? inputFormatters;

  @override
  State<AppTextField> createState() => _AppTextFieldState();
}

class _AppTextFieldState extends State<AppTextField>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shake = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 420),
  );

  @override
  void didUpdateWidget(AppTextField old) {
    super.didUpdateWidget(old);
    // A new (or changed) error shakes the field; clearing one stays quiet.
    if (widget.errorText != null && widget.errorText != old.errorText) {
      _shake.forward(from: 0);
      HapticFeedback.lightImpact();
    }
  }

  @override
  void dispose() {
    _shake.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final field = TextField(
      controller: widget.controller,
      obscureText: widget.obscureText,
      keyboardType: widget.keyboardType,
      textInputAction: widget.textInputAction,
      maxLines: widget.obscureText ? 1 : widget.maxLines,
      readOnly: widget.readOnly,
      onTap: widget.onTap,
      onChanged: widget.onChanged,
      autofillHints: widget.autofillHints,
      inputFormatters: widget.inputFormatters,
      decoration: InputDecoration(
        hintText: widget.hint,
        errorText: widget.errorText,
        prefixIcon:
            widget.prefixIcon == null ? null : Icon(widget.prefixIcon, size: 20),
        suffixIcon: widget.suffixIcon,
      ),
    );

    // Damped sine: three quick swings that die out, ±6px at the start.
    final shaken = AnimatedBuilder(
      animation: _shake,
      builder: (context, child) {
        final t = _shake.value;
        final dx = math.sin(t * math.pi * 4) * (1 - t) * 6;
        return Transform.translate(offset: Offset(dx, 0), child: child);
      },
      child: field,
    );

    if (widget.label == null) return shaken;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.label!, style: AppTextStyles.label),
        const SizedBox(height: AppSpacing.sm),
        shaken,
      ],
    );
  }
}
