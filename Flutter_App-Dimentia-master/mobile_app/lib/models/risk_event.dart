class RiskEvent {
  const RiskEvent({
    required this.hybridRisk,
    required this.weightedScore,
    required this.highStreakDays,
    required this.createdAt,
  });

  final String hybridRisk;
  final double weightedScore;
  final int highStreakDays;
  final DateTime createdAt;

  factory RiskEvent.fromJson(Map<String, dynamic> json) => RiskEvent(
        hybridRisk: json['hybridRisk']?.toString() ?? 'low',
        weightedScore: (json['weightedScore'] as num?)?.toDouble() ?? 0.0,
        highStreakDays: (json['highStreakDays'] as num?)?.toInt() ?? 0,
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ?? DateTime.now(),
      );
}
