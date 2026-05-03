import 'package:flutter/material.dart';

import 'alerts_screen.dart';
import 'chat_screen.dart';
import 'dashboard_screen.dart';
import 'report_screen.dart';
import 'settings_screen.dart';

class GuardianHomeScreen extends StatefulWidget {
  const GuardianHomeScreen({super.key});

  @override
  State<GuardianHomeScreen> createState() => _GuardianHomeScreenState();
}

class _GuardianHomeScreenState extends State<GuardianHomeScreen> {
  int _index = 0;

  static const _screens = [
    DashboardScreen(),
    AlertsScreen(),
    ChatScreen(),
    ReportScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(child: _screens[_index]),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (value) => setState(() => _index = value),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.dashboard_customize_outlined), label: 'Dashboard'),
              NavigationDestination(icon: Icon(Icons.notifications_active_outlined), label: 'Alerts'),
              NavigationDestination(icon: Icon(Icons.forum_outlined), label: 'AI Chat'),
              NavigationDestination(icon: Icon(Icons.picture_as_pdf_outlined), label: 'Reports'),
              NavigationDestination(icon: Icon(Icons.settings_outlined), label: 'Settings'),
            ],
          ),
        ),
      ),
    );
  }
}
