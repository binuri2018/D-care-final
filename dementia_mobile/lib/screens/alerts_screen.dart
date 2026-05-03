import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../models/alert_item.dart';
import '../providers/session_provider.dart';

class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> {
  List<AlertItem> _alerts = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(socketServiceProvider).listenAlerts((_) {
      if (mounted) _load();
    });
    _load();
  }

  Future<void> _load() async {
    final session = ref.read(sessionProvider);
    final patientId = session.selectedPatientId;
    final api = ref.read(sessionProvider.notifier).apiClient();

    setState(() => _loading = true);
    try {
      final rows = await api.getList('/alerts', query: patientId != null ? {'patientId': patientId} : null);
      if (!mounted) return;
      setState(() {
        _alerts = rows.map((row) => AlertItem.fromJson(row as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = getDioMessage(e);
        _loading = false;
      });
    }
  }

  Future<void> _ack(String id) async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    try {
      await api.post('/alerts/$id/ack', {});
      await _load();
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(getDioMessage(e))));
    }
  }

  Future<void> _ackAll() async {
    final session = ref.read(sessionProvider);
    final patientId = session.selectedPatientId;
    final api = ref.read(sessionProvider.notifier).apiClient();
    try {
      final response = await api.post('/alerts/ack-all', {
        if (patientId != null && patientId.isNotEmpty) 'patientId': patientId,
      });
      final count = response['acknowledgedCount'] ?? 0;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Marked $count alerts as read.')),
      );
      await _load();
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(getDioMessage(e))));
    }
  }

  Future<void> _downloadReport(AlertItem alert) async {
    final downloadUrl =
        alert.metadata['downloadUrl']?.toString() ??
        (alert.metadata['reportId'] != null ? '/api/reports/${alert.metadata['reportId']}/download' : null);
    if (downloadUrl == null || downloadUrl.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report link is missing for this alert.')),
      );
      return;
    }

    try {
      final api = ref.read(sessionProvider.notifier).apiClient();
      final session = ref.read(sessionProvider);
      final base = session.apiBaseUrl.replaceAll('/api', '');
      final absoluteUrl = '$base$downloadUrl';

      final dir = await getTemporaryDirectory();
      final fileName = 'dementia_report_${alert.id}.pdf';
      final filePath = '${dir.path}/$fileName';

      await api.raw.download(absoluteUrl, filePath);
      if (!mounted) return;

      final fileExists = await File(filePath).exists();
      if (!mounted) return;
      if (!fileExists) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Downloaded file not found.')),
        );
        return;
      }
      await Share.shareXFiles(
        [XFile(filePath)],
        subject: 'Dementia Report',
        text: 'Downloaded report file',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report downloaded. Choose app to open/share.')),
      );
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(getDioMessage(e))));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to open report: $e')));
    }
  }

  Color _severityColor(String severity) {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'high':
        return AppColors.error;
      case 'warning':
      case 'medium':
        return const Color(0xFFE58A31);
      default:
        return AppColors.primary;
    }
  }

  IconData _severityIcon(String severity) {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'high':
        return Icons.error_rounded;
      case 'warning':
      case 'medium':
        return Icons.warning_rounded;
      default:
        return Icons.info_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.62);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('Safety Alerts', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (_alerts.any((a) => !a.acknowledged))
            TextButton(
              onPressed: _ackAll,
              child: const Text('Mark all as read'),
            ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: _loading && _alerts.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  children: [
                    if (_error != null)
                      Container(
                        padding: const EdgeInsets.all(16),
                        margin: const EdgeInsets.only(bottom: 20),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, color: AppColors.error),
                            const SizedBox(width: 12),
                            Expanded(child: Text(_error!, style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w500))),
                          ],
                        ),
                      ),
                    
                    if (!_loading && _alerts.isEmpty && _error == null)
                      Container(
                        margin: const EdgeInsets.only(top: 60),
                        padding: const EdgeInsets.all(32),
                        child: Column(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(24),
                              decoration: BoxDecoration(
                                color: AppColors.success.withValues(alpha: 0.1),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.check_circle_outline_rounded, size: 64, color: AppColors.success),
                            ),
                            const SizedBox(height: 24),
                            Text('All Clear', style: Theme.of(context).textTheme.headlineSmall),
                            const SizedBox(height: 8),
                            Text(
                              'There are no active alerts at the moment. The patient is safe.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: muted, fontSize: 16),
                            ),
                          ],
                        ),
                      ),

                    ..._alerts.map((alert) {
                      final color = _severityColor(alert.severity);
                      final isAck = alert.acknowledged;

                      return Card(
                        margin: const EdgeInsets.only(bottom: 16),
                        elevation: isAck ? 0 : 2,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                          side: BorderSide(
                            color: isAck ? AppColors.outline : color.withValues(alpha: 0.3),
                            width: isAck ? 1 : 1.5,
                          ),
                        ),
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            gradient: isAck
                                ? null
                                : LinearGradient(
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                    colors: [
                                      color.withValues(alpha: 0.05),
                                      Colors.transparent,
                                    ],
                                  ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: isAck ? AppColors.surface : color.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Icon(_severityIcon(alert.severity), color: isAck ? muted : color, size: 24),
                                    ),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            alert.type.toUpperCase(),
                                            style: TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w700,
                                              letterSpacing: 0.5,
                                              color: isAck ? muted : color,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            timeago.format(alert.createdAt.toLocal()),
                                            style: TextStyle(color: muted, fontSize: 13),
                                          ),
                                        ],
                                      ),
                                    ),
                                    if (!isAck)
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: color,
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: const Text('NEW', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  alert.message,
                                  style: TextStyle(
                                    fontSize: 16,
                                    height: 1.4,
                                    color: isAck ? muted : Theme.of(context).colorScheme.onSurface,
                                    fontWeight: isAck ? FontWeight.normal : FontWeight.w500,
                                  ),
                                ),
                                if (alert.type == 'report-generated') ...[
                                  const SizedBox(height: 12),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: OutlinedButton.icon(
                                      onPressed: () => _downloadReport(alert),
                                      icon: const Icon(Icons.download_rounded),
                                      label: const Text('Download Report'),
                                    ),
                                  ),
                                ],
                                if (!isAck) ...[
                                  const SizedBox(height: 16),
                                  const Divider(),
                                  const SizedBox(height: 4),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      TextButton.icon(
                                        onPressed: () => _ack(alert.id),
                                        icon: const Icon(Icons.check_circle_outline),
                                        label: const Text('Mark as resolved'),
                                        style: TextButton.styleFrom(
                                          foregroundColor: AppColors.primary,
                                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      );
                    }),
                    const SizedBox(height: 24),
                  ],
                ),
        ),
      ),
    );
  }
}
