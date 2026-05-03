import 'package:flutter/material.dart';

class GradientBackground extends StatelessWidget {
  const GradientBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF1FA7EB),
            Color(0xFF1398E2),
            Color(0xFF0E82D6),
          ],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned(
            top: -120,
            left: -90,
            child: _WaveBlob(
              width: 300,
              height: 220,
              colors: [Color(0x4500D2FF), Color(0x1600A8FF)],
              borderRadius: BorderRadius.all(Radius.elliptical(180, 130)),
            ),
          ),
          Positioned(
            top: 80,
            right: -130,
            child: _WaveBlob(
              width: 340,
              height: 240,
              colors: [Color(0x3600C8FF), Color(0x120084D9)],
              borderRadius: BorderRadius.all(Radius.elliptical(220, 160)),
            ),
          ),
          Positioned(
            bottom: -170,
            left: -90,
            child: _WaveBlob(
              width: 420,
              height: 280,
              colors: [Color(0x2E43BBFF), Color(0x100A77CF)],
              borderRadius: BorderRadius.all(Radius.elliptical(260, 180)),
            ),
          ),
          Positioned(
            bottom: -110,
            right: -120,
            child: _WaveBlob(
              width: 360,
              height: 250,
              colors: [Color(0x2235A6F5), Color(0x0E0C70C3)],
              borderRadius: BorderRadius.all(Radius.elliptical(220, 170)),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class _WaveBlob extends StatelessWidget {
  const _WaveBlob({
    required this.width,
    required this.height,
    required this.colors,
    required this.borderRadius,
  });

  final double width;
  final double height;
  final List<Color> colors;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          borderRadius: borderRadius,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: colors,
          ),
        ),
      ),
    );
  }
}
