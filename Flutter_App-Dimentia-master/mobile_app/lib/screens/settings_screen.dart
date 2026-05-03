import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/navigation/detail_route.dart';
import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../providers/session_provider.dart';
import 'pairing_screen.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late final TextEditingController _apiController;
  late final TextEditingController _patientController;
  bool _requestLoading = false;

  @override
  void initState() {
    super.initState();
    final session = ref.read(sessionProvider);
    _apiController = TextEditingController(text: session.apiBaseUrl);
    _patientController = TextEditingController(text: session.selectedPatientId ?? '');
  }

  @override
  void dispose() {
    _apiController.dispose();
    _patientController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await ref.read(sessionProvider.notifier).setApiBaseUrl(_apiController.text.trim());
    await ref.read(sessionProvider.notifier).setSelectedPatient(_patientController.text.trim());

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved successfully')));
  }

  Future<void> _requestTracking() async {
    final patientId = _patientController.text.trim();
    if (patientId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a patient ID first.')),
      );
      return;
    }

    setState(() => _requestLoading = true);
    try {
      await _save();
      final api = ref.read(sessionProvider.notifier).apiClient();
      final data = await api.post('/pairing/request-tracking', {'patientId': patientId});

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(data['message']?.toString() ?? 'Tracking request sent.')),
      );
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(getDioMessage(e))),
      );
    } finally {
      if (mounted) setState(() => _requestLoading = false);
    }
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 8, top: 24),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.primary,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.62);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('Settings', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          children: [
            // Profile Header
            Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: AppColors.primary.withValues(alpha: 0.1),
                  child: Text(
                    session.user?.fullName.substring(0, 1).toUpperCase() ?? 'U',
                    style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.primary),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        session.user?.fullName ?? 'Unknown User',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        (session.user?.role ?? 'Role Not Set').toUpperCase(),
                        style: TextStyle(fontSize: 13, color: muted, fontWeight: FontWeight.bold, letterSpacing: 1),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            _buildSectionHeader('Connection Details'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    TextField(
                      controller: _apiController,
                      decoration: const InputDecoration(
                        labelText: 'Backend API URL',
                        prefixIcon: Icon(Icons.cloud_outlined),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _patientController,
                      decoration: const InputDecoration(
                        labelText: 'Target Patient ID',
                        prefixIcon: Icon(Icons.person_search_outlined),
                      ),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _save,
                        child: const Text('Save Network Settings', style: TextStyle(fontSize: 15)),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            _buildSectionHeader('Actions & Pairing'),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.link_rounded, color: AppColors.primary),
                    title: const Text('Manage Device Pairing'),
                    subtitle: Text('Generate code or join a patient', style: TextStyle(color: muted, fontSize: 13)),
                    trailing: const Icon(Icons.chevron_right, color: Colors.black26),
                    onTap: () => pushDetailPage(context, const PairingScreen()),
                  ),
                  const Divider(height: 1, indent: 56),
                  ListTile(
                    leading: _requestLoading 
                        ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.my_location_rounded, color: AppColors.primary),
                    title: const Text('Request Live Tracking'),
                    subtitle: Text('Asks patient permission to track', style: TextStyle(color: muted, fontSize: 13)),
                    onTap: _requestLoading ? null : _requestTracking,
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.error,
                side: const BorderSide(color: AppColors.error),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              onPressed: () => ref.read(sessionProvider.notifier).logout(),
              icon: const Icon(Icons.logout_rounded),
              label: const Text('Log Out', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                'Dementia Guardian v1.0.0',
                style: TextStyle(color: muted, fontSize: 13),
              ),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}
