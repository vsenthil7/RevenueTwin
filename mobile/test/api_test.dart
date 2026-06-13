import 'package:flutter_test/flutter_test.dart';
import 'package:revenuetwin_mobile/api/client.dart';
import 'package:revenuetwin_mobile/inbox_state.dart';

Map<String, dynamic> _f(int net) => {'type': 'intent', 'netRecoverable': {'amount': net}, 'grossDetected': {'amount': net}, 'confidence': 0.9};

void main() {
  test('cases() maps and sorts by net desc', () async {
    final client = RevenueTwinClient((m, path, body) async {
      expect(m, 'GET');
      expect(path, '/api/cases');
      return [
        {'id': 'small', 'customerId': 'a', 'status': 'open', 'detectedViaWorkIQ': false, 'findings': [_f(100)]},
        {'id': 'big', 'customerId': 'b', 'status': 'open', 'detectedViaWorkIQ': true, 'findings': [_f(900)]},
      ];
    });
    final list = await client.cases();
    expect(list.first.id, 'big');
    expect(list.length, 2);
  });

  test('portfolio() maps summary', () async {
    final client = RevenueTwinClient((m, path, body) async => {'totalRecoverable': {'amount': 500}, 'totalCases': 2, 'workIQAttributable': {'amount': 300}});
    final s = await client.portfolio();
    expect(s.totalRecoverableMinor, 500);
    expect(s.totalCases, 2);
    expect(s.workIQAttributableMinor, 300);
  });

  test('decide() posts and returns status', () async {
    String? sentPath; Object? sentBody;
    final client = RevenueTwinClient((m, path, body) async { sentPath = path; sentBody = body; return {'status': 'approved'}; });
    final st = await client.decide('case 1', 'approve');
    expect(st, 'approved');
    expect(sentPath, '/api/cases/case%201/decision');
    expect((sentBody as Map)['decision'], 'approve');
  });
}
