import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/detail_page_shell.dart';
import '../providers/session_provider.dart';

class MriUploadScreen extends ConsumerStatefulWidget {
  const MriUploadScreen({super.key});

  @override
  ConsumerState<MriUploadScreen> createState() => _MriUploadScreenState();
}

class _MriUploadScreenState extends ConsumerState<MriUploadScreen> {
  XFile? _selectedFile;
  String? _result;
  bool _isSuccess = false;
  bool _loading = false;

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery);
    if (file != null) {
      setState(() {
        _selectedFile = file;
        _result = null;
      });
    }
  }

  Future<void> _upload() async {
    final file = _selectedFile;
    if (file == null) return;

    final session = ref.read(sessionProvider);
    final patientId = session.user?.isPatient == true ? null : session.selectedPatientId;
    final api = ref.read(sessionProvider.notifier).apiClient().raw;

    setState(() => _loading = true);
    try {
      final form = FormData.fromMap({
        if (patientId != null) 'patientId': patientId,
        'mri': await MultipartFile.fromFile(File(file.path).path, filename: file.name),
      });

      final response = await api.post('/mri/upload', data: form);
      final risk = response.data['riskEvent']?['hybridRisk'];
      final label = response.data['mri']?['classLabel'];
      final mriRisk = response.data['mri']?['mappedRisk'];
      final confidence = (response.data['mri']?['confidence'] as num?)?.toDouble();

      if (!mounted) return;
      setState(() {
        _isSuccess = true;
        _result = [
          'Classification: ${label ?? 'Unknown'}',
          if (confidence != null) 'Confidence: ${(confidence * 100).toStringAsFixed(2)}%',
          'MRI Risk: ${mriRisk ?? 'N/A'}',
          'Hybrid Risk: ${risk ?? 'N/A'}',
        ].join('\n');
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Upload successful.')));
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _isSuccess = false;
        _result = getDioMessage(e);
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(getDioMessage(e))));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const muted = Color(0xFFE6F4FF);

    return DetailPageShell(
      appBar: AppBar(
        title: const Text('MRI Analysis', style: TextStyle(fontWeight: FontWeight.w600)),
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
                  'Scan Upload',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Upload the latest MRI image to run an on-device classification and update the hybrid risk model.',
                  style: TextStyle(color: muted, fontSize: 15, height: 1.4),
                ),
                const SizedBox(height: 32),
                InkWell(
                  onTap: _loading ? null : _pickImage,
                  borderRadius: BorderRadius.circular(24),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
                    decoration: BoxDecoration(
                      color: _selectedFile == null ? AppColors.surface : AppColors.primary.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(
                        color: _selectedFile == null ? AppColors.outline : AppColors.primary.withValues(alpha: 0.3),
                        width: 2,
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: _selectedFile == null
                                ? AppColors.outline.withValues(alpha: 0.3)
                                : AppColors.primary.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _selectedFile == null ? Icons.add_photo_alternate_outlined : Icons.check_circle_outline,
                            size: 48,
                            color: _selectedFile == null ? AppColors.mutedText : AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          _selectedFile == null ? 'Tap to browse gallery' : 'Image Selected',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: _selectedFile == null ? Theme.of(context).colorScheme.onSurface : AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _selectedFile == null ? 'PNG, JPG up to 10MB' : _selectedFile!.name,
                          style: const TextStyle(color: AppColors.mutedText, fontSize: 14),
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
                if (_result != null) ...[
                  const SizedBox(height: 32),
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: _isSuccess ? AppColors.success.withValues(alpha: 0.1) : AppColors.error.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: _isSuccess ? AppColors.success.withValues(alpha: 0.3) : AppColors.error.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              _isSuccess ? Icons.check_circle : Icons.error,
                              color: _isSuccess ? AppColors.success : AppColors.error,
                            ),
                            const SizedBox(width: 12),
                            Text(
                              _isSuccess ? 'Analysis Complete' : 'Upload Failed',
                              style: TextStyle(
                                color: _isSuccess ? AppColors.success : AppColors.error,
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(_result!, style: const TextStyle(fontSize: 14, height: 1.4)),
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
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                onPressed: (_selectedFile == null || _loading) ? null : _upload,
                icon: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Icon(Icons.cloud_upload_outlined),
                label: const Text('Upload & Analyze', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

