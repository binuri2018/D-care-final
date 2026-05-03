import 'package:flutter/material.dart';

import 'gradient_background.dart';

class DetailPageShell extends StatelessWidget {
  const DetailPageShell({
    super.key,
    required this.body,
    this.appBar,
  });

  final PreferredSizeWidget? appBar;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    return GradientBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: appBar,
        body: SafeArea(child: body),
      ),
    );
  }
}

