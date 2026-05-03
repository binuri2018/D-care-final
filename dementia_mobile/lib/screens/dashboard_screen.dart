import 'dart:async';

import 'package:dio/dio.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/navigation/detail_route.dart';
import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../models/risk_event.dart';
import '../providers/session_provider.dart';
import 'clinical_form_screen.dart';
import 'mri_upload_screen.dart';
import 'pairing_screen.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  RiskEvent? _currentRisk;
  List<FlSpot> _trend = [];
  LatLng? _patientLocation;
  DateTime? _lastHeartbeatAt;
  bool _loading = true;
  String? _error;
  String? _info;
  Timer? _liveRefreshTimer;
  bool _autoRefreshInFlight = false;
  GoogleMapController? _mapController;
  String _locationStatusLine = 'Lat/Lng: -- | Updated: --';
  String? _locationIssue;

  @override
  void initState() {
    super.initState();
    _loadData();
    _startLiveAutoRefresh();
  }

  @override
  void dispose() {
    _liveRefreshTimer?.cancel();
    _mapController?.dispose();
    super.dispose();
  }

  void _startLiveAutoRefresh() {
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!mounted) return;
      _refreshLiveData();
    });
  }

  Future<void> _refreshLiveData() async {
    if (_autoRefreshInFlight) return;
    _autoRefreshInFlight = true;
    try {
      await _loadData(silent: true);
    } finally {
      _autoRefreshInFlight = false;
    }
  }

  String _formatHeartbeatTime(DateTime? time) {
    if (time == null) return 'Unknown';
    final local = time.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$month/$day $hour:$minute';
  }

  double? _parseCoordinate(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.trim());
    return null;
  }

  void _applyHeartbeatToState(Map<String, dynamic>? heartbeat) {
    if (heartbeat == null) {
      _lastHeartbeatAt = null;
      _patientLocation = null;
      _locationIssue = null;
      _locationStatusLine = 'Lat/Lng: -- | Updated: --';
      return;
    }
    _lastHeartbeatAt = DateTime.tryParse(heartbeat['createdAt']?.toString() ?? '');
    final rawLat = heartbeat['latitude'];
    final rawLng = heartbeat['longitude'];
    final updatedText = _formatHeartbeatTime(_lastHeartbeatAt);

    if (rawLat == null || rawLng == null) {
      _patientLocation = null;
      _locationIssue = 'missing';
      _locationStatusLine = 'Lat/Lng: missing in heartbeat | Updated: $updatedText';
      return;
    }

    final lat = _parseCoordinate(rawLat);
    final lng = _parseCoordinate(rawLng);
    final hasInvalidNumber = lat == null || lng == null || !lat.isFinite || !lng.isFinite;
    final safeLat = lat ?? 0;
    final safeLng = lng ?? 0;
    final outOfRange = !hasInvalidNumber && (safeLat.abs() > 90 || safeLng.abs() > 180);
    final unusableSentinel = !hasInvalidNumber && safeLat.abs() < 0.000001 && safeLng.abs() < 0.000001;

    if (hasInvalidNumber || outOfRange || unusableSentinel) {
      _patientLocation = null;
      _locationIssue = 'invalid';
      _locationStatusLine = 'Lat/Lng invalid ($rawLat, $rawLng) | Updated: $updatedText';
      return;
    }

    _patientLocation = LatLng(safeLat, safeLng);
    _locationIssue = null;
    _locationStatusLine = 'Lat: ${safeLat.toStringAsFixed(6)}, Lng: ${safeLng.toStringAsFixed(6)} | Updated: $updatedText';
  }

  Future<void> _centerMap({bool animated = true}) async {
    if (_mapController == null || _patientLocation == null) return;
    final update = CameraUpdate.newLatLngZoom(_patientLocation!, 16);
    if (animated) {
      await _mapController!.animateCamera(update);
    } else {
      await _mapController!.moveCamera(update);
    }
  }

  Future<void> _openInGoogleMaps() async {
    if (_patientLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No patient location available yet.')),
      );
      return;
    }

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${_patientLocation!.latitude},${_patientLocation!.longitude}',
    );
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open Google Maps app.')),
      );
    }
  }

  Future<void> _loadData({bool silent = false}) async {
    final session = ref.read(sessionProvider);
    final patientId = session.selectedPatientId;

    if (patientId == null || patientId.isEmpty) {
      setState(() {
        if (!silent) _loading = false;
        _error = null;
        _info = 'Set selected patient ID from Settings or Pairing.';
      });
      return;
    }

    final api = ref.read(sessionProvider.notifier).apiClient();
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
        _info = null;
      });
    }

    RiskEvent? risk;
    Map<String, dynamic>? heartbeat;
    List<dynamic> trends = [];
    String? nextError;
    String? nextInfo;

    try {
      trends = await api.getList('/clinical-form/trends/$patientId');
    } on DioException catch (e) {
      nextError = getDioMessage(e);
    }

    try {
      final riskData = await api.get('/risk/current/$patientId');
      if (riskData['createdAt'] != null) {
        risk = RiskEvent.fromJson(riskData);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode != 404) {
        final msg = getDioMessage(e);
        if (msg.contains('pending patient approval')) {
          nextInfo = 'Tracking is pending patient approval.';
        } else {
          nextError = msg;
        }
      }
    }

    try {
      final hbData = await api.get('/heartbeats/latest/$patientId');
      if (hbData['createdAt'] != null) {
        heartbeat = hbData;
      }
    } on DioException catch (e) {
      if (e.response?.statusCode != 404) {
        final msg = getDioMessage(e);
        if (msg.contains('pending patient approval')) {
          nextInfo = 'Tracking is pending patient approval.';
        } else {
          nextError = msg;
        }
      }
    }

    final points = <FlSpot>[];
    for (var i = 0; i < trends.length; i++) {
      final row = trends[i] as Map<String, dynamic>;
      final prob = (row['modelProbability'] as num?)?.toDouble() ?? 0;
      points.add(FlSpot(i.toDouble(), prob));
    }

    final hasAnyData = risk != null || heartbeat != null || points.isNotEmpty;

    setState(() {
      _currentRisk = risk;
      _trend = points;
      _applyHeartbeatToState(heartbeat);
      if (!silent) {
        _loading = false;
        _error = nextError;
      }
      _info = nextInfo;
      if (!hasAnyData && nextInfo == null && nextError == null) {
        _info = 'No patient data yet. Start with check-in, MRI upload, and heartbeat.';
      }
    });

    await _centerMap(animated: false);
  }

  Widget _buildMapSnippet(Color muted) {
    if (_patientLocation == null) {
      final message = _locationIssue == 'invalid'
          ? 'Latest heartbeat has invalid coordinates.'
          : 'Patient heartbeat will appear here.';
      return Container(
        height: 180,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: AppColors.cardTopTint,
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.location_off_outlined, color: muted, size: 32),
              const SizedBox(height: 8),
              Text(
                'No location yet.\n$message',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted),
              ),
            ],
          ),
        ),
      );
    }

    return SizedBox(
      height: 220,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          children: [
            GoogleMap(
              initialCameraPosition: CameraPosition(target: _patientLocation!, zoom: 16),
              onMapCreated: (controller) {
                _mapController = controller;
                _centerMap(animated: false);
              },
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
              compassEnabled: true,
              markers: {
                Marker(
                  markerId: const MarkerId('patient-location'),
                  position: _patientLocation!,
                  infoWindow: const InfoWindow(title: 'Patient Location'),
                ),
              },
            ),
            Positioned(
              top: 12,
              left: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.95),
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: const [
                    BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2)),
                  ],
                ),
                child: Text(
                  'Updated: ${_formatHeartbeatTime(_lastHeartbeatAt)}',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.66);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadData,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.dashboard_outlined, color: Colors.white),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Command Center',
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white),
                        ),
                        Text(
                          'Patient overview and tracking',
                          style: const TextStyle(color: Color(0xFFE8F6FF), fontSize: 14, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _loading ? null : _loadData,
                    style: IconButton.styleFrom(backgroundColor: AppColors.surface, padding: const EdgeInsets.all(12)),
                    icon: _loading
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.refresh),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 20),
                  decoration: BoxDecoration(
                    color: AppColors.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(_error!, style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w500)),
                ),
              if (_info != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 20),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(_info!, style: TextStyle(color: AppColors.primary.withValues(alpha: 0.8), fontWeight: FontWeight.w500)),
                ),
              
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Real-time Location', style: Theme.of(context).textTheme.titleLarge),
                          if (_currentRisk != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: _getRiskColor(_currentRisk!.hybridRisk).withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '${_currentRisk!.hybridRisk.toUpperCase()} RISK',
                                style: TextStyle(
                                  color: _getRiskColor(_currentRisk!.hybridRisk),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                ),
                              ),
                            )
                        ],
                      ),
                      const SizedBox(height: 16),
                      _buildMapSnippet(muted),
                      const SizedBox(height: 10),
                      Text(
                        _locationStatusLine,
                        style: TextStyle(color: muted, fontSize: 12, fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _patientLocation == null ? null : _openInGoogleMaps,
                              icon: const Icon(Icons.map_outlined),
                              label: const Text('Open in Google Maps'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 20),
              
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Cognitive Decline Trend', style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 24),
                      SizedBox(
                        height: 180,
                        child: LineChart(
                          LineChartData(
                            minY: 0,
                            maxY: 1,
                            lineBarsData: [
                              LineChartBarData(
                                spots: _trend,
                                isCurved: true,
                                barWidth: 3,
                                color: AppColors.primary,
                                dotData: const FlDotData(show: false),
                                belowBarData: BarAreaData(
                                  show: true, 
                                  color: AppColors.primary.withValues(alpha: 0.1),
                                ),
                              ),
                            ],
                            borderData: FlBorderData(show: false),
                            gridData: FlGridData(
                              show: true,
                              drawVerticalLine: false,
                              getDrawingHorizontalLine: (_) => const FlLine(color: AppColors.outline, strokeWidth: 1, dashArray: [4, 4]),
                            ),
                            titlesData: FlTitlesData(
                              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                              leftTitles: AxisTitles(
                                sideTitles: SideTitles(
                                  showTitles: true,
                                  reservedSize: 32,
                                  getTitlesWidget: (value, meta) => Text(
                                    value.toStringAsFixed(1),
                                    style: const TextStyle(color: AppColors.mutedText, fontSize: 12),
                                  ),
                                ),
                              ),
                              bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 24),
              Text(
                'Quick Actions',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 16),
              GridView.count(
                crossAxisCount: MediaQuery.of(context).size.width > 600 ? 3 : 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 16,
                crossAxisSpacing: 16,
                childAspectRatio: 1.1,
                children: [
                  _ModernActionTile(
                    label: 'Upload MRI',
                    icon: Icons.image_search_outlined,
                    color: const Color(0xFF6366F1), // Indigo
                    onTap: () => pushDetailPage(context, const MriUploadScreen()),
                  ),
                  _ModernActionTile(
                    label: 'Daily Check-in',
                    icon: Icons.assignment_outlined,
                    color: const Color(0xFF14B8A6), // Teal
                    onTap: () => pushDetailPage(context, const ClinicalFormScreen()),
                  ),
                  _ModernActionTile(
                    label: 'Patient Pairing',
                    icon: Icons.phonelink_ring_outlined,
                    color: const Color(0xFFF59E0B), // Amber
                    onTap: () => pushDetailPage(context, const PairingScreen()),
                  ),
                ],
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Color _getRiskColor(String riskLevel) {
    if (riskLevel.toLowerCase() == 'high') return AppColors.error;
    if (riskLevel.toLowerCase() == 'medium') return AppColors.warning;
    return AppColors.success;
  }
}

class _ModernActionTile extends StatelessWidget {
  const _ModernActionTile({required this.label, required this.icon, required this.color, required this.onTap});

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(height: 16),
              Text(
                label,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
