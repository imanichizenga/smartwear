import 'package:intl/intl.dart';

const _exponents = {'TZS': 0, 'KES': 2, 'UGX': 0, 'RWF': 0, 'USD': 2, 'EUR': 2, 'GBP': 2};

/// Money is integer minor units + ISO code (TZS has no minor unit). Formats like "TZS 85,000".
String formatMoney(num? amount, [String currency = 'TZS']) {
  if (amount == null) return '—';
  final exp = _exponents[currency.toUpperCase()] ?? 2;
  final major = amount / _pow10(exp);
  final f = NumberFormat.currency(locale: 'en_US', symbol: '', decimalDigits: exp);
  return '$currency ${f.format(major).trim()}';
}

/// Number without currency ("21,000") — used in tier tables where the currency is stated once.
String formatAmount(num amount, [String currency = 'TZS']) {
  final exp = _exponents[currency.toUpperCase()] ?? 2;
  return NumberFormat.currency(locale: 'en_US', symbol: '', decimalDigits: exp).format(amount / _pow10(exp)).trim();
}

int _pow10(int e) {
  var r = 1;
  for (var i = 0; i < e; i++) {
    r *= 10;
  }
  return r;
}
