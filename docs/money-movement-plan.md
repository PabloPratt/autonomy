# AUTONOMY money movement: review plan

Research date: October 20, 2026. This is a product/compliance planning document,
not a legal opinion. Phase 1 moves no real money. All savings and bill allocations
are recommendations. Sandbox Link access is not authorization to debit a bank.

## Proposed flow and obligations

The proposed future flow is partner bank → partner-bank/program account →
household ledger allocation → verified biller. Each arrow needs an approved rail,
an identified account holder, consent, reconciliation and a failure path.

| Capability | Required work before production |
| --- | --- |
| Read bank data | Provider approval, explicit data consent, least-privilege access, deletion/revocation, encrypted credentials and incident procedures. |
| Pull funds | Sponsor bank/processor underwriting; verify account ownership; KYC/CIP and sanctions screening as allocated by contract; valid ACH authorization; limits, fraud controls and returns handling. |
| Hold pooled funds | Consumer-approved bank or licensed program partner, contractual custody/FBO structure, beneficial-owner ledger, segregation from company operating cash, daily reconciliation, withdrawals, complaints and insolvency arrangements. |
| Pay bills | Verify biller/account/destination, contract for the supported payment rail, payment authorization, duplicate prevention, settlement confirmation, remittance matching and refunds. A generic ACH credit cannot reach every utility or creditor. |

FinCEN's payment-processor exemption depends on the actual activity and specific
conditions. It does not establish a blanket exemption for a consumer household
wallet. Counsel must assess federal MSB obligations, applicable state
money-transmitter licensing or exemptions, and responsibilities retained by the
app even when a partner holds funds. Registration is not a substitute for state
licensing. Do not route customer money through AUTONOMY's operating bank account.
[FinCEN ruling](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-money-services-business)

Consumer recurring debits require written or similarly authenticated
authorization and a copy for the consumer. Implement revocation/stop-payment
handling and required notices for varying transfers. Each partner authorizes
their own bank; accepting a household invitation cannot grant authority over
their partner's account. [Regulation E §1005.10](https://www.consumerfinance.gov/rules-policy/regulations/1005/10/)

Have the originating bank approve the ACH authorization text, amount/timing
scope, WEB account validation, evidence retention and retrieval, and return-rate
controls. Keep versioned consent records separate from data-link consent and
household access. [Nacha authorization guidance](https://www.nacha.org/news/importance-compliant-ach-authorizations)

## Providers to evaluate

No provider was provisioned or selected. Stripe Directory was consulted first,
but its setup endpoint could not be retrieved in this environment; the following
is primary-source research on the providers requested in the task.

| Candidate | Potential fit | Approval questions |
| --- | --- | --- |
| Stripe Financial Connections + Treasury for platforms | Financial Connections links/verifies bank data; Treasury supplies financial accounts through bank partnerships. These are separate capabilities. | Obtain written approval for consumer couples, joint beneficial ownership, custody and paying outside billers. Do not assume business-focused Treasury eligibility covers consumer household wallets. Use current v2 documentation for a new integration. |
| Dwolla | Bank payments and, for approved programs, holding balances/wallet functionality. | Which consumer and pooled-funds model is supported? Who performs KYC, holds money, bears returns, and handles biller delivery? |
| Unit | Infrastructure for accounts and wallets through bank partners, including individual accounts. | Consumer program and partner approval, joint ownership, bank relationship, program minimums, ledger responsibilities and bill-pay coverage. |

Sources: [Stripe Financial Connections](https://stripe.com/financial-connections),
[Treasury for platforms](https://docs.stripe.com/treasury/connect),
[Stripe service terms](https://stripe.com/legal/ssa-service-terms),
[Dwolla pricing and capabilities](https://www.dwolla.com/pricing),
[Unit accounts and wallets](https://www.unit.co/accounts-and-wallets).

## Costs and an explicit budget model

Do not promise free transfers or custody. Dwolla currently quotes custom pricing
based on volume, rails and integration needs. Treasury and a consumer Unit
program require a written commercial quote for this use case. Financial
Connections/data fees are separate from payment execution. Confirm current
product-specific fees rather than using a Payments price as a wallet quote.
[Dwolla pricing](https://www.dwolla.com/pricing), [Stripe pricing](https://stripe.com/pricing).

Request quotes for setup/underwriting, monthly platform minimum, active accounts,
KYC and manual reviews, data refreshes, ACH debits and credits, same-day rails,
returns, disputes, bill delivery, statements, support, reserves and termination.
Also budget engineering, security reviews, legal licensing analysis, compliance
operations, reconciliation, insurance and incident response.

Illustrative planning scenario only (not provider prices): 100 households,
200 linked partner banks, two funding debits per partner/month and ten bill
credits per household/month means 400 debits + 1,000 credits = 1,400 entries.
If a hypothetical blended fee is $0.50/entry and a hypothetical platform minimum
is $1,000/month, rail expense would be $1,700/month before verification, data,
returns, reserves or staffing. Use the signed quote to replace every assumption.

## Phases and release gates

1. **Current: manual planning.** Supabase accounts, shared plans, manual/CSV data,
   recommended contributions and sandbox Link only. Never label a recommendation
   paid or transferred. The manual paid checklist remains user attestation.
2. **Read-only bank data.** Obtain provider approval; ship encrypted token storage,
   signed webhook verification, cursor sync, pending replacement, disconnect and
   deletion in the shared project. The older isolated backend has an adapter to
   reuse after schema/security review. No money permissions.
3. **Partner-approved account funding pilot.** Counsel signs off on the flow and
   licensing allocation; sponsor approves consumer onboarding, KYC, account
   ownership checks, mandates, limits and return handling. Use partner-hosted
   custody and an append-only double-entry ledger. Pilot with explicit opt-in.
4. **Biller payments.** Add supported destinations, recipient verification,
   idempotency, signed webhook replay protection, settlement reconciliation,
   refunds and exception queues. Funding availability must account for ACH
   returns; a webhook or displayed balance alone is not irrevocable settlement.
5. **Automation and pooled accounts.** Launch only after joint access/withdrawal
   rules, separation/death/dispute procedures, disclosures, statements, account
   closure and any deposit-insurance representations are approved by the bank
   and counsel. Add monitoring, customer support and an operational stop switch.

Required tests before any live pilot: duplicate requests/webhooks, insufficient
funds, revoked consent, delayed/returned debits, partial biller delivery, wrong
destinations, partner removal, competing edits, ledger imbalance, processor
outage, refunds, data deletion and recovery from a failed reconciliation.
