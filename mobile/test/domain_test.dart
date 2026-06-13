import 'package:flutter_test/flutter_test.dart';
import 'package:revenuetwin_mobile/models/leakage_case.dart';
import 'package:revenuetwin_mobile/api/client.dart';
import 'package:revenuetwin_mobile/inbox_state.dart';

Map<String, dynamic> _finding(int net, int gross, {String type = 'intent', double conf = 0.9, String? span, String? link}) => {
  'type': type,
  'netRecoverable': {'amount': net},
  'grossDetected': {'amount': gross},
  'confidence': conf,
  if (span != null) 'extractedSpan': span,
  if (link != null) 'deepLink': link,
};

void main() {
  group('fmtGBP', () {
    test('formats minor units with thousands separators', () {
      expect(fmtGBP(120000), 'GBP 1,200.00');
      expect(fmtGBP(0), 'GBP 0.00');
      expect(fmtGBP(99), 'GBP 0.99');
      expect(fmtGBP(123456789), 'GBP 1,234,567.89');
    });
  });

  group('LeakageCase.fromJson', () {
    test('maps a Work IQ case with provenance', () {
      final c = LeakageCase.fromJson({
        'id': 'c1', 'customerId': 'northwind', 'status': 'open', 'detectedViaWorkIQ': true,
        'findings': [_finding(120000, 120000, span: '12% uplift', link: 'teams://x')],
      });
      expect(c.netRecoverableMinor, 120000);
      expect(c.detectedViaWorkIQ, true);
      expect(c.provenance!.span, '12% uplift');
      expect(c.isActionable, true);
    });
    test('maps a structural case with no findings', () {
      final c = LeakageCase.fromJson({'id': 'c2', 'customerId': 'acme', 'status': 'approved', 'detectedViaWorkIQ': false, 'findings': []});
      expect(c.netRecoverableMinor, 0);
      expect(c.type, 'unknown');
      expect(c.provenance, isNull);
      expect(c.isActionable, false);
    });
    test('work iq case falls back to default span/link', () {
      final c = LeakageCase.fromJson({'id': 'c3', 'customerId': 'x', 'status': 'triaged', 'detectedViaWorkIQ': true, 'findings': [_finding(1, 1)]});
      expect(c.provenance!.deepLink, '#');
      expect(c.isActionable, true);
    });
  });
}
