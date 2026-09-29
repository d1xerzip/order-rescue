// Shopify GraphQL Admin API 2026-07 CurrencyCode, verified 2026-09-29:
// https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CurrencyCode
// Preserve P05's three-letter source normalization boundary. USDC is a valid
// configured currency but its source amount is not yet supported by normalization.
// XXX means no currency and cannot be a merchant comparison currency.
const supportedCurrencies = new Set(
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB
BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CVE CZK DJF DKK DOP DZD
EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF
IDR ILS INR IQD IRR ISK JEP JMD JOD JPY KES KGS KHR KID KMF KRW KWD KYD KZT
LAK LBP LKR LRD LSL LTL LVL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK
MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON
RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLL SOS SRD SSP STN SYP SZL THB TJS
TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD
XCG XOF XPF YER ZAR ZMW`.split(/\s+/),
);

export function isSupportedCurrency(value: unknown): value is string {
  return typeof value === "string" && supportedCurrencies.has(value);
}

export function isKnownCurrency(value: unknown): value is string {
  return value === "USDC" || isSupportedCurrency(value);
}
