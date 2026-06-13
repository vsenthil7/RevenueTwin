/// Pure domain model for the RevenueTwin mobile app. No Flutter imports here so it is unit-
/// testable with plain `dart test`. Money is always integer minor units (pence), mirroring the
/// backend contract.

class Provenance {
  final String source;
  final String span;
  final String deepLink;
  const Provenance({required this.source, required this.span, required this.deepLink});
}

class LeakageCase {
  final String id;
  final String customer;
  final String type;
  final int grossDetectedMinor;
  final int netRecoverableMinor;
  final double confidence;
  final bool detectedViaWorkIQ;
  final String status;
  final Provenance? provenance;

  const LeakageCase({
    required this.id,
    required this.customer,
    required this.type,
    required this.grossDetectedMinor,
    required this.netRecoverableMinor,
    required this.confidence,
    required this.detectedViaWorkIQ,
    required this.status,
    this.provenance,
  });

  bool get isActionable => status == 'open' || status == 'triaged';

  /// Map a backend LeakageCase JSON shape to the mobile model (mirrors web/api.js mapCase).
  factory LeakageCase.fromJson(Map<String, dynamic> j) {
    final findings = (j['findings'] as List?) ?? const [];
    int net = 0, gross = 0;
    for (final f in findings) {
      net += (((f as Map)['netRecoverable'] ?? const {})['amount'] ?? 0) as int;
      gross += ((f['grossDetected'] ?? const {})['amount'] ?? 0) as int;
    }
    final primary = findings.isNotEmpty ? findings.first as Map : const {};
    final conf = (primary['confidence'] ?? 0);
    final viaWorkIQ = j['detectedViaWorkIQ'] == true;
    return LeakageCase(
      id: j['id'] as String,
      customer: j['customerId'] as String,
      type: (primary['type'] ?? 'unknown') as String,
      grossDetectedMinor: gross,
      netRecoverableMinor: net,
      confidence: (conf is int) ? conf.toDouble() : conf as double,
      detectedViaWorkIQ: viaWorkIQ,
      status: j['status'] as String,
      provenance: viaWorkIQ
          ? Provenance(
              source: 'Commercial intent (Work IQ)',
              span: (primary['extractedSpan'] ?? 'Commercial commitment detected') as String,
              deepLink: (primary['deepLink'] ?? '#') as String,
            )
          : null,
    );
  }
}

/// Format integer minor units (pence) as GBP, mirroring web fmtGBP.
String fmtGBP(int minor) {
  final pounds = minor / 100.0;
  final s = pounds.toStringAsFixed(2);
  final parts = s.split('.');
  final intPart = parts[0];
  final buf = StringBuffer();
  for (int i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 == 0) buf.write(',');
    buf.write(intPart[i]);
  }
  return 'GBP ' + buf.toString() + '.' + parts[1];
}
