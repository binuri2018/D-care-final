import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/dio_error.dart';
import '../core/theme/app_theme.dart';
import '../providers/session_provider.dart';

class ChatMessage {
  final String text;
  final bool isUser;
  final String? sourceLabel;
  final bool isError;
  final DateTime timestamp;

  ChatMessage({
    required this.text,
    required this.isUser,
    this.sourceLabel,
    this.isError = false,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  static const _introText =
      'Hello! I am your AI Clinical Assistant. Ask me questions about patient records, recent alerts, or cognitive trends.';

  final _controller = TextEditingController();
  final _scrollController = ScrollController();

  List<ChatMessage> _messages = [];
  bool _historyLoading = false;
  bool _sending = false;
  String? _activePatientId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncHistoryWithSelectedPatient());
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _scrollToBottom() {
    if (!_scrollController.hasClients) return;
    Future.delayed(const Duration(milliseconds: 100), () {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOut,
      );
    });
  }

  String _sourceLabelFromValue(String? source) {
    return source == 'fallback' ? 'Local AI Model' : 'Cloud LLM';
  }

  Future<void> _syncHistoryWithSelectedPatient() async {
    final patientId = ref.read(sessionProvider).selectedPatientId;
    if (patientId == _activePatientId) return;

    _activePatientId = patientId;
    setState(() {
      _messages = [];
      _historyLoading = true;
    });

    if (patientId == null || patientId.isEmpty) {
      setState(() {
        _messages = [
          ChatMessage(
            text: 'Select a patient ID in Settings first, then your chat history will load here.',
            isUser: false,
          ),
        ];
        _historyLoading = false;
      });
      return;
    }

    await _loadHistory(patientId);
  }

  Future<void> _loadHistory(String patientId, {bool scrollAfter = false}) async {
    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() => _historyLoading = true);

    try {
      final rows = await api.getList('/llm/chat-history', query: {'patientId': patientId, 'limit': 100});

      if (!mounted || _activePatientId != patientId) return;

      final nextMessages = <ChatMessage>[];
      for (final row in rows) {
        if (row is! Map) continue;
        final map = Map<String, dynamic>.from(row);
        final createdAt = DateTime.tryParse(map['createdAt']?.toString() ?? '') ?? DateTime.now();
        final source = map['source']?.toString();
        final query = map['query']?.toString();
        final response = map['response']?.toString();

        if (query != null && query.isNotEmpty) {
          nextMessages.add(ChatMessage(text: query, isUser: true, timestamp: createdAt));
        }

        if (response != null && response.isNotEmpty) {
          nextMessages.add(
            ChatMessage(
              text: response,
              isUser: false,
              sourceLabel: _sourceLabelFromValue(source),
              timestamp: createdAt,
            ),
          );
        }
      }

      if (nextMessages.isEmpty) {
        nextMessages.add(ChatMessage(text: _introText, isUser: false));
      }

      setState(() {
        _messages = nextMessages;
        _historyLoading = false;
      });

      if (scrollAfter) {
        _scrollToBottom();
      }
    } on DioException catch (e) {
      if (!mounted || _activePatientId != patientId) return;
      setState(() {
        _historyLoading = false;
        _messages = [ChatMessage(text: _introText, isUser: false)];
      });

      final message = getDioMessage(e);
      if (message.contains('not paired')) {
        _showSnack('Guardian is not paired with this patient.');
      } else if (message.contains('Invalid or expired token') || message.contains('Missing authorization token')) {
        _showSnack('Session expired. Please login again.');
      } else {
        _showSnack(message);
      }
    }
  }

  Future<void> _ask() async {
    final query = _controller.text.trim();
    if (query.isEmpty || _sending) return;

    if (query.length < 5) {
      _showSnack('Please enter at least 5 characters for a meaningful question.');
      return;
    }

    final patientId = ref.read(sessionProvider).selectedPatientId;
    if (patientId == null || patientId.isEmpty) {
      _showSnack('Please select a patient ID in Settings first.');
      return;
    }

    final api = ref.read(sessionProvider.notifier).apiClient();
    setState(() {
      _sending = true;
      _controller.clear();
    });

    try {
      await api.post('/llm/query-records', {'patientId': patientId, 'query': query});
      await _loadHistory(patientId, scrollAfter: true);
    } on DioException catch (e) {
      final message = getDioMessage(e);
      if (message.contains('Invalid or expired token') || message.contains('Missing authorization token')) {
        _showSnack('Session expired. Please login again.');
      } else if (message.contains('not paired')) {
        _showSnack('Guardian is not paired with this patient.');
      } else {
        _showSnack(message);
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Widget _buildMessageBubble(ChatMessage message) {
    final isUser = message.isUser;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            Container(
              margin: const EdgeInsets.only(right: 12),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: message.isError ? AppColors.error.withValues(alpha: 0.1) : Colors.white,
                shape: BoxShape.circle,
                boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
              ),
              child: Icon(
                message.isError ? Icons.error_outline : Icons.auto_awesome,
                size: 20,
                color: message.isError ? AppColors.error : AppColors.primary,
              ),
            ),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              decoration: BoxDecoration(
                color: isUser ? AppColors.primary : (message.isError ? AppColors.error.withValues(alpha: 0.05) : Colors.white),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(20),
                  topRight: const Radius.circular(20),
                  bottomLeft: Radius.circular(isUser ? 20 : 4),
                  bottomRight: Radius.circular(isUser ? 4 : 20),
                ),
                boxShadow: isUser
                    ? [BoxShadow(color: AppColors.primary.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 3))]
                    : const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                border: !isUser ? Border.all(color: message.isError ? AppColors.error.withValues(alpha: 0.3) : AppColors.outline) : null,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (message.sourceLabel != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        message.sourceLabel!,
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.primaryDarkText),
                      ),
                    ),
                    const SizedBox(height: 6),
                  ],
                  Text(
                    message.text,
                    style: TextStyle(
                      color: isUser ? Colors.white : (message.isError ? AppColors.error : Theme.of(context).colorScheme.onSurface),
                      fontSize: 15,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (isUser) ...[
            Container(
              margin: const EdgeInsets.only(left: 12),
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
              child: const Icon(Icons.person, size: 20, color: AppColors.primary),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedPatientId = ref.watch(sessionProvider.select((state) => state.selectedPatientId));
    if (selectedPatientId != _activePatientId) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _syncHistoryWithSelectedPatient());
    }

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: const Text('Clinical AI Assistant', style: TextStyle(fontWeight: FontWeight.w600)),
        centerTitle: false,
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _activePatientId == null || _activePatientId!.isEmpty || _historyLoading
                ? null
                : () => _loadHistory(_activePatientId!, scrollAfter: true),
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh history',
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _historyLoading && _messages.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(height: 10),
                          Text('Loading chat history...'),
                        ],
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.only(left: 16, right: 16, bottom: 20, top: 12),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) => _buildMessageBubble(_messages[index]),
                    ),
            ),
            if (_sending)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                    SizedBox(width: 12),
                    Text('Analyzing patient records...', style: TextStyle(color: AppColors.mutedText, fontSize: 13)),
                  ],
                ),
              ),
            Container(
              padding: const EdgeInsets.all(16).copyWith(bottom: 16 + MediaQuery.of(context).padding.bottom),
              decoration: const BoxDecoration(
                color: Colors.white,
                boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, -2))],
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: AppColors.outline),
                      ),
                      child: TextField(
                        controller: _controller,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _ask(),
                        decoration: const InputDecoration(
                          hintText: 'Ask about behavior, trends, or risks...',
                          hintStyle: TextStyle(color: AppColors.mutedText),
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    decoration: BoxDecoration(
                      color: _sending ? AppColors.mutedText : AppColors.primary,
                      shape: BoxShape.circle,
                      boxShadow: _sending
                          ? null
                          : [BoxShadow(color: AppColors.primary.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
                    ),
                    child: IconButton(
                      icon: const Icon(Icons.send_rounded, color: Colors.white),
                      onPressed: _sending ? null : _ask,
                      tooltip: 'Send Question',
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
