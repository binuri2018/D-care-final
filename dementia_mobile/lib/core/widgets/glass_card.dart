import 'package:flutter/material.dart';

class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.borderColor = const Color(0xFFDDEAF4),
    this.gradient,
    this.radius = 30,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color borderColor;
  final Gradient? gradient;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: gradient == null ? Colors.white : null,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor, width: 1.0),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A074A79),
            blurRadius: 22,
            spreadRadius: 1,
            offset: Offset(0, 12),
          ),
        ],
        gradient:
            gradient ??
            const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0xFFFFFFFF),
                Color(0xFFF9FCFF),
              ],
            ),
      ),
      child: child,
    );
  }
}
