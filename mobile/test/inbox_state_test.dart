import 'package:flutter_test/flutter_test.dart';
import 'package:revenuetwin_mobile/api/client.dart';
import 'package:revenuetwin_mobile/inbox_state.dart';

Map<String, dynamic> _f(int net) => {'type': 'intent', 'netRecoverable': {'amount': net}, 'grossDetected': {'amount': net}, 'confidence': 0.9};

RevenueTwinClient _client(List<Map<String, dynamic>> cases) => RevenueTwinClient((m, path, body) async {
  if (path == '/api/cases') return cases;
  final decision = (body as Map)['decision'];
  return {'status': decision == 'approve' ? 'approved' : 'rejected'};
});

void main() {
  test('load hydrates pending + pre-decided, computes recovered and workIQ share', () async {
    final s = InboxState(_client([
      {'id': 'open1', 'customerId': 'a', 'status': 'open', 'detectedViaWorkIQ': true, 'findings': [_f(120000)]},
      {'id': 'done1', 'customerId': 'b', 'status': 'approved', 'detectedViaWorkIQ': false, 'findings': [_f(40000)]},
    ]));
    await s.load();
    expect(s.pending.length, 1);
    expect(s.pending.first.id, 'open1');
    expect(s.decisions['done1'], 'approved');
    expect(s.recoveredMinor, 40000);
    expect(s.workIQShare, closeTo(120000 / 160000, 1e-9));
  });

  test('approve and reject update decisions and recovered total', () async {
    final s = InboxState(_client([
      {'id': 'x', 'customerId': 'a', 'status': 'open', 'detectedViaWorkIQ': false, 'findings': [_f(50000)]},
      {'id': 'y', 'customerId': 'b', 'status': 'open', 'detectedViaWorkIQ': false, 'findings': [_f(20000)]},
    ]));
    await s.load();
    await s.approve('x');
    await s.reject('y');
    expect(s.decisions['x'], 'approved');
    expect(s.decisions['y'], 'rejected');
    expect(s.recoveredMinor, 50000);
    expect(s.pending, isEmpty);
    expect(s.workIQShare, 0);
  });
}
