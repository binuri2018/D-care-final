import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'core/widgets/gradient_background.dart';
import 'providers/session_provider.dart';
import 'screens/auth_screen.dart';
import 'screens/guardian_home_screen.dart';
import 'screens/patient_home_screen.dart';

class DementiaApp extends ConsumerWidget {
  const DementiaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Dementia Guardian',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const GradientBackground(child: _RootGate()),
    );
  }
}

class _RootGate extends ConsumerWidget {
  const _RootGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionProvider);

    if (state.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final user = state.user;
    if (!state.isAuthenticated || user == null) {
      return const AuthScreen();
    }

    return user.isGuardian ? const GuardianHomeScreen() : const PatientHomeScreen();
  }
}
