import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/widgets/detail_page_shell.dart';
import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../providers/session_provider.dart';

class PairingScreen extends ConsumerStatefulWidget {
  const PairingScreen({super.key});

  @override
  ConsumerState<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends ConsumerState<PairingScreen> {
  final _pairKeyController = TextEditingController();
  String? _statusText;
  String? _createdKey;
  String? _trackingStatus;
  String? _pairedPatientId;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _refreshStatus();
  }

  @override
  void dispose() {
    _pairKeyController.dispose();
    super.dispose();
  }

  Color _trackingColor(String? value) {
    switch (value) {
      case 'approved':
        return AppColors.success;
      case 'pending':
        return const Color(0xFFE58A31);
      case 'rejected':
        return AppColors.error;
      default:
        return AppColors.mutedText;
    }
  }

  Future<void> _createKey() async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() {
      _loading = true;
      _statusText = null;
    });
    try {
      final data = await api.post('/pairing/create-key', {});
      if (!mounted) return;
      setState(() {
        _createdKey = data['pairKey']?.toString();
        _statusText = 'Pair key created successfully.';
      });
      await _refreshStatus();
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _statusText = getDioMessage(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _copyText(String text, String successMessage) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(successMessage)));
  }

  Future<void> _joinKey() async {
    final key = _pairKeyController.text.trim().toUpperCase();
    if (key.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter a pair key.')));
      return;
    }

    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() {
      _loading = true;
      _statusText = null;
    });
    try {
      await api.post('/pairing/join', {'pairKey': key});
      if (!mounted) return;
      setState(() => _statusText = 'Successfully paired with the patient.');
      _pairKeyController.clear();
      await _refreshStatus();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Successfully paired.')));
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _statusText = getDioMessage(e));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(getDioMessage(e))));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refreshStatus() async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    try {
      final data = await api.get('/pairing/status');
      final paired = data['paired'] == true;
      final patientId = data['patientId']?.toString();
      final status = data['trackingStatus']?.toString() ?? 'not_requested';

      if (paired && patientId != null && patientId.isNotEmpty) {
        await ref.read(sessionProvider.notifier).setSelectedPatient(patientId);
      }

      if (!mounted) return;
      setState(() {
        _pairedPatientId = patientId;
        _trackingStatus = status;
        _statusText = paired ? 'Pairing active. Tracking status: $status' : 'Not paired yet.';
      });
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _statusText = getDioMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).user;
    final isPatient = user?.isPatient ?? false;
    const muted = Color(0xFFE6F4FF);
    final headingStyle = Theme.of(context).textTheme.titleLarge?.copyWith(
      fontWeight: FontWeight.bold,
      color: Colors.white,
    );

    return DetailPageShell(
      appBar: AppBar(
        title: const Text('Device Pairing', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: RefreshIndicator(
        onRefresh: _refreshStatus,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          children: [
            Text('Account Info', style: headingStyle),
            const SizedBox(height: 16),
            
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(isPatient ? Icons.elderly : Icons.health_and_safety, color: AppColors.primary, size: 28),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Current Role', style: TextStyle(fontSize: 14, color: AppColors.mutedText)),
                              const SizedBox(height: 4),
                              Text(
                                user?.role.toUpperCase() ?? 'UNKNOWN',
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Divider(height: 1),
                    ),
                    
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Tracking Status', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: _trackingColor(_trackingStatus).withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: _trackingColor(_trackingStatus).withValues(alpha: 0.2)),
                          ),
                          child: Text(
                            (_trackingStatus ?? 'not_requested').toUpperCase(),
                            style: TextStyle(
                              color: _trackingColor(_trackingStatus),
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                    
                    if (_pairedPatientId != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.outline),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.link, color: AppColors.primary, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Linked: $_pairedPatientId',
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 32),

            if (isPatient) ...[
              Text('Your Patient ID', style: headingStyle),
              const SizedBox(height: 8),
              Text(
                'Share this ID with your guardian so they can connect with your account.',
                style: const TextStyle(color: muted, fontSize: 14),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: SelectableText(
                        user?.id ?? '',
                        style: const TextStyle(fontSize: 16, fontFamily: 'monospace', fontWeight: FontWeight.bold),
                      ),
                    ),
                    IconButton(
                      onPressed: user != null && user.id.isNotEmpty
                          ? () => _copyText(user.id, 'Patient ID copied to clipboard.')
                          : null,
                      icon: const Icon(Icons.copy_rounded, color: AppColors.primary),
                      tooltip: 'Copy ID',
                    ),
                  ],
                ),
              ),
              
              const SizedBox(height: 32),
              Text('Generate Pair Key', style: headingStyle),
              const SizedBox(height: 16),
              
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  onPressed: _loading ? null : _createKey,
                  icon: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.key),
                  label: const Text('Create New Pair Key', style: TextStyle(fontSize: 16)),
                ),
              ),

              if (_createdKey != null && _createdKey!.isNotEmpty) ...[
                const SizedBox(height: 24),
                Card(
                  color: AppColors.primary,
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      children: [
                        const Text(
                          'YOUR PAIRING KEY',
                          style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, letterSpacing: 1.5, fontSize: 12),
                        ),
                        const SizedBox(height: 16),
                        SelectableText(
                          _createdKey!,
                          style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w900, letterSpacing: 8),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 24),
                        OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: Colors.white54),
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          ),
                          onPressed: () => _copyText(_createdKey!, 'Pairing key copied to clipboard.'),
                          icon: const Icon(Icons.copy_rounded),
                          label: const Text('Copy Key'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],

            if (!isPatient) ...[
              Text('Connect to Patient', style: headingStyle),
              const SizedBox(height: 8),
              Text(
                'Enter the code shown on the patient\'s device to link accounts.',
                style: const TextStyle(color: muted, fontSize: 14),
              ),
              const SizedBox(height: 16),
              
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      Container(
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppColors.outline),
                        ),
                        child: TextField(
                          controller: _pairKeyController,
                          textCapitalization: TextCapitalization.characters,
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 4),
                          textAlign: TextAlign.center,
                          maxLength: 12,
                          decoration: const InputDecoration(
                            hintText: 'ENTER KEY',
                            border: InputBorder.none,
                            counterText: '',
                            contentPadding: EdgeInsets.symmetric(vertical: 16),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          ),
                          onPressed: _loading ? null : _joinKey,
                          icon: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.link),
                          label: const Text('Join Pairing', style: TextStyle(fontSize: 16)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            
            if (_statusText != null) ...[
              const SizedBox(height: 32),
              Center(child: Text(_statusText!, style: const TextStyle(color: muted), textAlign: TextAlign.center)),
            ],
            
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}
