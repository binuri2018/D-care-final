class AlertItem {
  const AlertItem({
    required this.id,
    required this.type,
    required this.severity,
    required this.message,
    required this.acknowledged,
    required this.createdAt,
    required this.metadata,
  });

  final String id;
  final String type;
  final String severity;
  final String message;
  final bool acknowledged;
  final DateTime createdAt;
  final Map<String, dynamic> metadata;

  factory AlertItem.fromJson(Map<String, dynamic> json) => AlertItem(
        id: json['_id']?.toString() ?? '',
        type: json['type']?.toString() ?? '',
        severity: json['severity']?.toString() ?? 'info',
        message: json['message']?.toString() ?? '',
        acknowledged: json['acknowledged'] == true,
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ?? DateTime.now(),
        metadata: json['metadata'] is Map ? Map<String, dynamic>.from(json['metadata'] as Map) : const {},
      );
}
