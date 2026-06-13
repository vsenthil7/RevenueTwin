/// Pure approval-inbox state — no Flutter, fully unit-testable. Holds the loaded portfolio and
/// applies optimistic decisions, recording the running recovered total.
import '../models/leakage_case.dart';
import '../api/client.dart';

class InboxState {
  final RevenueTwinClient client;
  List<LeakageCase> cases = [];
  final Map<String, String> decisions = {};
  InboxState(this.client);

  Future<void> load() async {
    cases = await client.cases();
    for (final c in cases) {
      if (c.status == 'approved' || c.status == 'rejected') decisions[c.id] = c.status;
    }
  }

  /// Cases still awaiting a decision (actionable and not yet decided).
  List<LeakageCase> get pending =>
      cases.where((c) => c.isActionable && !decisions.containsKey(c.id)).toList();

  /// Sum of net recoverable across cases the user has approved (minor units).
  int get recoveredMinor {
    var sum = 0;
    for (final c in cases) {
      if (decisions[c.id] == 'approved') sum += c.netRecoverableMinor;
    }
    return sum;
  }

  /// Work IQ attributable share of pending recoverable (0..1).
  double get workIQShare {
    var total = 0, wq = 0;
    for (final c in cases) {
      total += c.netRecoverableMinor;
      if (c.detectedViaWorkIQ) wq += c.netRecoverableMinor;
    }
    return total == 0 ? 0 : wq / total;
  }

  Future<void> approve(String id) => _decide(id, 'approve', 'approved');
  Future<void> reject(String id) => _decide(id, 'reject', 'rejected');

  Future<void> _decide(String id, String verb, String resultStatus) async {
    await client.decide(id, verb);
    decisions[id] = resultStatus;
  }
}
