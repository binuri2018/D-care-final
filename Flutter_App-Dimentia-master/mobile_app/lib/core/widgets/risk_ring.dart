import 'dart:math' as math;

import 'package:flutter/material.dart';

class RiskRing extends StatelessWidget {
  const RiskRing({super.key, required this.risk, required this.score});

  final String risk;
  final double score;

  Color get _color {
    switch (risk) {
      case 'critical':
        return const Color(0xFFD84A59);
      case 'high':
        return const Color(0xFFE88C38);
      case 'medium':
        return const Color(0xFFE8B63D);
      default:
        return const Color(0xFF1FAFA5);
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = (score / 4).clamp(0, 1).toDouble();
    const textColor = Color(0xFF173248);

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: progress),
      duration: const Duration(milliseconds: 850),
      builder: (context, value, _) {
        return CustomPaint(
          painter: _RiskRingPainter(progress: value, color: _color),
          child: SizedBox(
            width: 132,
            height: 132,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    risk.toUpperCase(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: textColor,
                      letterSpacing: 1.0,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    score.toStringAsFixed(2),
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: textColor,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _RiskRingPainter extends CustomPainter {
  const _RiskRingPainter({required this.progress, required this.color});

  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const strokeWidth = 10.0;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;

    final bgPaint = Paint()
      ..color = const Color(0xFFDCE7EB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;

    final fgPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, bgPaint);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * progress,
      false,
      fgPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _RiskRingPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.color != color;
  }
}
