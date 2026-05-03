import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/detail_page_shell.dart';
import '../providers/session_provider.dart';

class ClinicalFormScreen extends ConsumerStatefulWidget {
  const ClinicalFormScreen({super.key});

  @override
  ConsumerState<ClinicalFormScreen> createState() => _ClinicalFormScreenState();
}

class _ClinicalFormScreenState extends ConsumerState<ClinicalFormScreen> {
  double _age = 70;
  double _bmi = 24;
  double _education = 1;
  double _mmse = 24;
  double _functional = 7;
  bool _memoryComplaints = false;
  bool _forgetfulness = false;
  bool _loading = false;
  String? _status;

  Future<void> _submit() async {
    final session = ref.read(sessionProvider);
    final api = ref.read(sessionProvider.notifier).apiClient();
    final patientId = session.user?.isPatient == true ? null : session.selectedPatientId;

    setState(() => _loading = true);
    try {
      final response = await api.post('/clinical-form', {
        if (patientId != null) 'patientId': patientId,
        'age': _age.round(),
        'bmi': _bmi,
        'educationLevel': _education.round(),
        'mmse': _mmse.round(),
        'functionalAssessment': _functional.round(),
        'memoryComplaints': _memoryComplaints ? 1 : 0,
        'forgetfulness': _forgetfulness ? 1 : 0,
      });

      final risk = response['riskEvent']?['hybridRisk'];
      final probability = (response['clinical']?['modelProbability'] as num?)?.toDouble();
      final clinicalRisk = response['clinical']?['mappedRisk']?.toString();
      if (!mounted) return;
      setState(() {
        _status = [
          'Submitted successfully.',
          if (probability != null) 'Probability: ${probability.toStringAsFixed(3)}',
          'Clinical Risk: ${clinicalRisk ?? 'N/A'}',
          'Hybrid Risk: ${risk ?? 'N/A'}',
        ].join('\n');
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Form submitted successfully.')),
      );
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _status = getDioMessage(e));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(getDioMessage(e))),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 12, top: 24),
      child: Row(
        children: [
          Icon(icon, color: Colors.white, size: 20),
          const SizedBox(width: 8),
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const muted = Color(0xFFE6F4FF);

    return DetailPageShell(
      appBar: AppBar(
        title: const Text('Clinical Assessment', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              children: [
                Text(
                  'Daily Check-in',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Please fill out the patient\'s daily metrics to update the hybrid risk model.',
                  style: TextStyle(color: muted, fontSize: 15, height: 1.4),
                ),
                _buildSectionHeader('Basic Demographics', Icons.person_outline),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        _SliderField(
                          label: 'Age',
                          value: _age,
                          min: 50,
                          max: 95,
                          unit: 'yrs',
                          onChanged: (v) => setState(() => _age = v),
                        ),
                        const Divider(height: 32),
                        _SliderField(
                          label: 'BMI',
                          value: _bmi,
                          min: 10,
                          max: 45,
                          unit: 'kg/m2',
                          onChanged: (v) => setState(() => _bmi = v),
                        ),
                        const Divider(height: 32),
                        _SliderField(
                          label: 'Education Level',
                          value: _education,
                          min: 0,
                          max: 3,
                          divisions: 3,
                          unit: 'tier',
                          onChanged: (v) => setState(() => _education = v),
                        ),
                      ],
                    ),
                  ),
                ),
                _buildSectionHeader('Cognitive & Functional', Icons.psychology_outlined),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        _SliderField(
                          label: 'MMSE Score',
                          value: _mmse,
                          min: 0,
                          max: 30,
                          unit: 'pts',
                          onChanged: (v) => setState(() => _mmse = v),
                        ),
                        const Divider(height: 32),
                        _SliderField(
                          label: 'Functional Assessment',
                          value: _functional,
                          min: 0,
                          max: 10,
                          unit: 'lvl',
                          onChanged: (v) => setState(() => _functional = v),
                        ),
                      ],
                    ),
                  ),
                ),
                _buildSectionHeader('Reported Symptoms', Icons.medical_services_outlined),
                Card(
                  child: Column(
                    children: [
                      SwitchListTile.adaptive(
                        value: _memoryComplaints,
                        activeColor: AppColors.primary,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                        onChanged: (v) => setState(() => _memoryComplaints = v),
                        title: const Text('Memory Complaints', style: TextStyle(fontWeight: FontWeight.w500)),
                        subtitle: const Text(
                          'Reported by patient or family',
                          style: TextStyle(color: AppColors.mutedText, fontSize: 13),
                        ),
                      ),
                      const Divider(height: 1),
                      SwitchListTile.adaptive(
                        value: _forgetfulness,
                        activeColor: AppColors.primary,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                        onChanged: (v) => setState(() => _forgetfulness = v),
                        title: const Text('Observed Forgetfulness', style: TextStyle(fontWeight: FontWeight.w500)),
                        subtitle: const Text(
                          'Objective signs of memory loss',
                          style: TextStyle(color: AppColors.mutedText, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_status != null) ...[
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: _status!.startsWith('Sub')
                          ? AppColors.success.withValues(alpha: 0.1)
                          : AppColors.error.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: _status!.startsWith('Sub')
                            ? AppColors.success.withValues(alpha: 0.3)
                            : AppColors.error.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _status!.startsWith('Sub') ? Icons.check_circle : Icons.error,
                          color: _status!.startsWith('Sub') ? AppColors.success : AppColors.error,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _status!,
                            style: TextStyle(
                              color: _status!.startsWith('Sub') ? AppColors.success : AppColors.error,
                              fontWeight: FontWeight.w500,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 40),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(20).copyWith(bottom: 20 + MediaQuery.of(context).padding.bottom),
            decoration: const BoxDecoration(
              color: Colors.white,
              boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, -2))],
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Text('Submit Assessment', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SliderField extends StatelessWidget {
  const _SliderField({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    this.divisions,
    required this.onChanged,
    required this.unit,
  });

  final String label;
  final double value;
  final double min;
  final double max;
  final int? divisions;
  final String unit;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '${value.toStringAsFixed(divisions != null ? 0 : 1)} $unit',
                style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 6,
            activeTrackColor: AppColors.primary,
            inactiveTrackColor: AppColors.primary.withValues(alpha: 0.15),
            thumbColor: AppColors.primary,
            overlayColor: AppColors.primary.withValues(alpha: 0.2),
            valueIndicatorShape: const RectangularSliderValueIndicatorShape(),
          ),
          child: Slider(
            value: value,
            min: min,
            max: max,
            divisions: divisions,
            label: value.toStringAsFixed(divisions != null ? 0 : 1),
            onChanged: onChanged,
          ),
        ),
      ],
    );
  }
}

