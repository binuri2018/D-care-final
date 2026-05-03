import 'package:battery_plus/battery_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../core/navigation/detail_route.dart';
import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../providers/session_provider.dart';
import '../services/heartbeat_service.dart';
import 'pairing_screen.dart';

class PatientHomeScreen extends ConsumerStatefulWidget {
  const PatientHomeScreen({super.key});

  @override
  ConsumerState<PatientHomeScreen> createState() => _PatientHomeScreenState();
}

class _PatientHomeScreenState extends ConsumerState<PatientHomeScreen> {
  final _heartbeatService = HeartbeatService();
  bool _heartbeatOn = false;
  bool _loadingTracking = true;
  bool _sendingSos = false;
  String _status = 'Disconnected';
  String _trackingStatus = 'not_requested';
  List<Map<String, dynamic>> _pendingRequests = [];

  @override
  void initState() {
    super.initState();
    _loadTrackingState();
  }

  Future<void> _loadTrackingState() async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() => _loadingTracking = true);

    try {
      final statusData = await api.get('/pairing/status');
      final pendingRows = await api.getList('/pairing/pending-requests');

      setState(() {
        _trackingStatus = statusData['trackingStatus']?.toString() ?? 'not_requested';
        _pendingRequests = pendingRows
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
      });
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _status = getDioMessage(e);
      });
    } finally {
      if (mounted) setState(() => _loadingTracking = false);
    }
  }

  bool get _trackingApproved => _trackingStatus == 'approved';

  Future<void> _confirmTracking(String pairingId, String action) async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    
    // Optimistic UI update
    setState(() {
      _pendingRequests.removeWhere((req) => req['_id']?.toString() == pairingId);
    });

    try {
      final data = await api.post('/pairing/confirm-tracking', {
        'pairingId': pairingId,
        'action': action,
      });

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(data['message']?.toString() ?? 'Tracking decision updated.')),
      );
      await _loadTrackingState();
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(getDioMessage(e))),
      );
      await _loadTrackingState(); // reload to revert optimistic update if failed
    }
  }

  Future<void> _sendHeartbeat() async {
    if (!_trackingApproved) {
      setState(() => _status = 'Tracking must be approved before sending heartbeat.');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tracking must be approved first.')),
      );
      return;
    }

    try {
      final permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() => _status = 'Location permission denied');
        return;
      }

      final position = await Geolocator.getCurrentPosition();
      final battery = Battery();
      final batteryLevel = await battery.batteryLevel;

      final api = ref.read(sessionProvider.notifier).apiClient();
      await api.post('/heartbeats', {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'batteryLevel': batteryLevel,
      });

      if (!mounted) return;
      
      setState(() => _status = 'Heartbeat manually sent at ${TimeOfDay.now().format(context)}');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Heartbeat sent successfully.')),
      );
    } on DioException catch (e) {
      setState(() => _status = getDioMessage(e));
    } catch (e) {
      setState(() => _status = e.toString());
    }
  }

  Future<void> _toggleHeartbeat(bool value) async {
    if (!_trackingApproved) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please approve tracking from your Guardian first.')),
      );
      return;
    }

    if (value) {
      await _heartbeatService.start();
      setState(() {
        _heartbeatOn = true;
        _status = 'Auto heartbeat running';
      });
    } else {
      await _heartbeatService.stop();
      setState(() {
        _heartbeatOn = false;
        _status = 'Auto heartbeat stopped';
      });
    }
  }

  Future<void> _triggerSos() async {
    if (_sendingSos) return;
    setState(() => _sendingSos = true);
    try {
      final api = ref.read(sessionProvider.notifier).apiClient();
      final data = await api.post('/alerts/sos', {});
      if (!mounted) return;
      final message = data['message']?.toString() ?? 'SOS Triggered: Guardian alert sent.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } on DioException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(getDioMessage(e))),
      );
    } finally {
      if (mounted) {
        setState(() => _sendingSos = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).user;
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.62);

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('My Space', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: () => pushDetailPage(context, const PairingScreen()),
            icon: const Icon(Icons.phonelink_ring_outlined),
            tooltip: 'Pairing settings',
          ),
          IconButton(
            onPressed: () => ref.read(sessionProvider.notifier).logout(),
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Logout',
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadTrackingState,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            children: [
              Text(
                'Hello, ${user?.fullName.split(' ').first ?? 'Patient'}',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: Colors.white),
              ),
              const SizedBox(height: 8),
              const Text(
                'Welcome to your personal dashboard.',
                style: TextStyle(color: Color(0xFFE8F6FF), fontSize: 16, fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 24),

              if (_pendingRequests.isNotEmpty) ...[
                ..._pendingRequests.map((request) {
                  final guardian = request['guardianId'];
                  final guardianName = guardian is Map ? guardian['fullName']?.toString() : null;
                  final pairingId = request['_id']?.toString() ?? '';

                  return Container(
                    margin: const EdgeInsets.only(bottom: 24),
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF3CD), // Light warning yellow/amber
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: const Color(0xFFFFD56B), width: 2),
                      boxShadow: [
                        BoxShadow(color: const Color(0xFFFFD56B).withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 4)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: const BoxDecoration(color: Color(0xFFE58A31), shape: BoxShape.circle),
                              child: const Icon(Icons.pan_tool_rounded, color: Colors.white, size: 24),
                            ),
                            const SizedBox(width: 16),
                            const Expanded(
                              child: Text('Tracking Request', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFFB16100))),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '${guardianName ?? 'Your Guardian'} is asking to track your location for safety.',
                          style: const TextStyle(fontSize: 16, color: Color(0xFF8A4B00), height: 1.4),
                        ),
                        const SizedBox(height: 24),
                        Row(
                          children: [
                            Expanded(
                              child: FilledButton(
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.success,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                ),
                                onPressed: pairingId.isEmpty ? null : () => _confirmTracking(pairingId, 'approve'),
                                child: const Text('Allow', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppColors.error,
                                  side: const BorderSide(color: AppColors.error, width: 2),
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                ),
                                onPressed: pairingId.isEmpty ? null : () => _confirmTracking(pairingId, 'reject'),
                                child: const Text('Decline', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                }),
              ],

              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(Icons.my_location_rounded, color: AppColors.primary, size: 28),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Location Sharing', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                Text(
                                  _trackingApproved ? 'Guardian can see location' : 'Sharing is paused',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: _trackingApproved ? AppColors.success : AppColors.warning,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Switch.adaptive(
                            value: _heartbeatOn,
                            onChanged: (_loadingTracking || !_trackingApproved) ? null : _toggleHeartbeat,
                            activeColor: AppColors.primary,
                          ),
                        ],
                      ),
                      if (_status != 'Disconnected') ...[
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.outline),
                          ),
                          child: Text(_status, style: TextStyle(color: muted, fontSize: 13), textAlign: TextAlign.center),
                        ),
                      ],
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          ),
                          onPressed: (_loadingTracking || !_trackingApproved) ? null : _sendHeartbeat,
                          icon: const Icon(Icons.send_rounded),
                          label: const Text('Send Update Now', style: TextStyle(fontSize: 16)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 32),
              
              InkWell(
                onTap: _triggerSos,
                borderRadius: BorderRadius.circular(32),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 24),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: BorderRadius.circular(32),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.error.withValues(alpha: 0.4),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Colors.white, size: 64),
                      const SizedBox(height: 16),
                      Text(
                        _sendingSos ? 'SENDING SOS...' : 'EMERGENCY SOS',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 2,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Tap to alert your guardian immediately',
                        style: TextStyle(color: Colors.white70, fontSize: 16),
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}
