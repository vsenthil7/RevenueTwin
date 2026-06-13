/// API client for the RevenueTwin mobile app. The transport is injected (a function returning a
/// decoded JSON body for a path), so all mapping logic is unit-testable with no real network.
import '../models/leakage_case.dart';

/// A transport: given (method, path, body) returns the decoded JSON response.
typedef Transport = Future<dynamic> Function(String method, String path, Object? body);

class PortfolioSummary {
  final int totalRecoverableMinor;
  final int totalCases;
  final int workIQAttributableMinor;
  const PortfolioSummary({
    required this.totalRecoverableMinor,
    required this.totalCases,
    required this.workIQAttributableMinor,
  });
  factory PortfolioSummary.fromJson(Map<String, dynamic> j) => PortfolioSummary(
        totalRecoverableMinor: ((j['totalRecoverable'] ?? const {})['amount'] ?? 0) as int,
        totalCases: (j['totalCases'] ?? 0) as int,
        workIQAttributableMinor: ((j['workIQAttributable'] ?? const {})['amount'] ?? 0) as int,
      );
}

class RevenueTwinClient {
  final Transport _t;
  RevenueTwinClient(this._t);

  Future<List<LeakageCase>> cases() async {
    final raw = await _t('GET', '/api/cases', null) as List;
    final list = raw.map((e) => LeakageCase.fromJson(e as Map<String, dynamic>)).toList();
    list.sort((b, c) => c.netRecoverableMinor.compareTo(b.netRecoverableMinor));
    return list;
  }

  Future<PortfolioSummary> portfolio() async {
    final raw = await _t('GET', '/api/portfolio', null) as Map<String, dynamic>;
    return PortfolioSummary.fromJson(raw);
  }

  Future<String> decide(String caseId, String decision) async {
    final raw = await _t('POST', '/api/cases/' + Uri.encodeComponent(caseId) + '/decision', {'decision': decision}) as Map<String, dynamic>;
    return (raw['status'] ?? 'unknown') as String;
  }
}
