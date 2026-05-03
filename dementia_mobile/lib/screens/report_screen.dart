import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_email_sender/flutter_email_sender.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../providers/session_provider.dart';

class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key});

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  final _emailController = TextEditingController();
  bool _loading = false;
  String _status = 'Ready to generate report.';
  String? _downloadUrl;
  String? _localReportPath;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<bool> _generate({required String triggerSource, bool silentSuccess = false}) async {
    final session = ref.read(sessionProvider);
    final patientId = session.selectedPatientId;
    if (patientId == null) {
      if (!mounted) return false;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please select a patient ID in Settings first.')));
      return false;
    }

    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() => _loading = true);
    try {
      final data = await api.post('/reports/generate', {
        'patientId': patientId,
        'triggerSource': triggerSource,
      });

      final downloadUrl = data['downloadUrl']?.toString();
      if (!mounted) return false;
      setState(() {
        _downloadUrl = downloadUrl;
        _localReportPath = null;
        _status = 'Report generated successfully.';
      });
      if (!silentSuccess) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report generated successfully')));
      }
      return true;
    } on DioException catch (e) {
      if (!mounted) return false;
      setState(() => _status = getDioMessage(e));
      return false;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String> _ensureLocalReportFile() async {
    if (_localReportPath != null && await File(_localReportPath!).exists()) {
      return _localReportPath!;
    }

    if (_downloadUrl == null) {
      throw Exception('Report URL not available. Generate report first.');
    }

    final session = ref.read(sessionProvider);
    final baseUrl = session.apiBaseUrl.replaceAll('/api', '');
    final absoluteUrl = '$baseUrl$_downloadUrl';
    final directory = await getTemporaryDirectory();
    final filePath = '${directory.path}/dementia_report_${DateTime.now().millisecondsSinceEpoch}.pdf';

    final dio = ref.read(sessionProvider.notifier).apiClient().raw;
    await dio.download(absoluteUrl, filePath);

    _localReportPath = filePath;
    return filePath;
  }

  Future<void> _downloadAndOpenReport() async {
    try {
      final filePath = await _ensureLocalReportFile();
      await Share.shareXFiles(
        [XFile(filePath)],
        subject: 'Dementia Report',
        text: 'Downloaded report file',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report downloaded. Choose app to open/share.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to download report: $error')));
    }
  }

  Future<void> _sendToDoctor() async {
    final to = _emailController.text.trim();
    if (to.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter doctor email first.')));
      return;
    }
    if (_downloadUrl == null) {
      final generated = await _generate(triggerSource: 'manual', silentSuccess: true);
      if (!generated) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not generate report automatically.')),
        );
        return;
      }
    }

    final session = ref.read(sessionProvider);
    try {
      final attachmentPath = await _ensureLocalReportFile();
      final emailBody =
          'Please review the latest dementia report.\n\nPatient ID: ${session.selectedPatientId ?? 'N/A'}\nReport endpoint: ${session.apiBaseUrl.replaceAll('/api', '')}$_downloadUrl';
      final email = Email(
        subject: 'Dementia Patient Report',
        recipients: [to],
        body: emailBody,
        attachmentPaths: [attachmentPath],
      );

      await FlutterEmailSender.send(email);
      setState(() => _status = 'Email composer opened.');
    } on PlatformException catch (error) {
      final lower = '${error.code} ${error.message}'.toLowerCase();
      final noClient = lower.contains('not_available') || lower.contains('no email clients');
      if (noClient) {
        final attachmentPath = await _ensureLocalReportFile();
        await Share.shareXFiles(
          [XFile(attachmentPath)],
          subject: 'Dementia Report for $to',
          text:
              'No email app found on this phone.\nPlease send this report manually to: $to\n\nPatient ID: ${session.selectedPatientId ?? 'N/A'}',
        );
        if (!mounted) return;
        setState(() => _status = 'No email app found. Opened share sheet instead.');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No email app found. Use share options to send report manually.')),
        );
        return;
      }
      if (!mounted) return;
      setState(() => _status = 'Could not open email composer.');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to open email app: $error')),
      );
    } catch (error) {
      setState(() => _status = 'Could not open email composer.');
      if (mounted) {
         ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to open email app: $error')));
      }
    }
  }

  Widget _buildActionCard({
    required String title,
    required String description,
    required IconData icon,
    required Color iconColor,
    required VoidCallback? onTap,
    bool isLoading = false,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: AppColors.outline),
      ),
      child: InkWell(
        onTap: isLoading ? null : onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: isLoading 
                    ? SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2, color: iconColor))
                    : Icon(icon, color: iconColor, size: 28),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.62)),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.3)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.62);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('Clinical Reports', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          children: [
            Text(
              'Generate doctor-ready PDF reports including MRI snapshots, behavioral trends, and geofence incidents.',
              style: TextStyle(color: muted, fontSize: 15, height: 1.4),
            ),
            const SizedBox(height: 32),

            Text('Generate Report', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),

            _buildActionCard(
              title: 'Standard Report',
              description: 'Generate a comprehensive report spanning all recent activity.',
              icon: Icons.description_outlined,
              iconColor: AppColors.primary,
              isLoading: _loading,
              onTap: () => _generate(triggerSource: 'manual'),
            ),
            
            _buildActionCard(
              title: 'Incident Report',
              description: 'Focus on recent alerts and unacknowledged incidents.',
              icon: Icons.warning_amber_rounded,
              iconColor: const Color(0xFFE58A31),
              isLoading: _loading,
              onTap: () => _generate(triggerSource: 'automatic'),
            ),

            if (_downloadUrl != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.check_circle, color: AppColors.success),
                        const SizedBox(width: 12),
                        Text('Report Ready', style: TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(_downloadUrl!, style: const TextStyle(fontSize: 13, decoration: TextDecoration.underline), maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _loading ? null : _downloadAndOpenReport,
                        icon: const Icon(Icons.download_rounded),
                        label: const Text('Download PDF'),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 32),
            const Divider(),
            const SizedBox(height: 32),

            Text('Share with Neurologist', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),

            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: AppColors.outline),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: TextField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                          hintText: 'doctor@hospital.com',
                          labelText: 'Neurologist Email',
                          prefixIcon: Icon(Icons.email_outlined),
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
                        onPressed: _loading ? null : _sendToDoctor,
                        icon: const Icon(Icons.send_rounded),
                        label: const Text('Send via Email App', style: TextStyle(fontSize: 16)),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            if (_status != 'Ready to generate report.' && _downloadUrl == null) ...[
              const SizedBox(height: 24),
              Center(
                child: Text(_status, style: TextStyle(color: muted, fontSize: 13), textAlign: TextAlign.center),
              ),
            ],
            
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

