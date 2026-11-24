import {parseNotificationEvent,renderNotification} from './notification-event';

const complaints=['COMPLAINT_OPENED','COMPLAINT_COMMENTED','COMPLAINT_ESCALATED','COMPLAINT_ASSIGNED','COMPLAINT_INFO_REQUESTED',
  'COMPLAINT_DECIDED','COMPLAINT_FINAL_DECISION','COMPLAINT_CLOSED','COMPLAINT_REOPENED','COMPLAINT_WITHDRAWN','COMPLAINT_SOURCE_UPDATED'];
const cases: [string,Record<string,string>,string,string][] = [
  ...['KYC_VERIFIED','KYC_REJECTED','KYC_RETRY_REQUIRED'].map(type=>[type,{attemptId:'attempt-1'},'ACCOUNT','/settings/account-security'] as [string,Record<string,string>,string,string]),
  ...['MEMBERSHIP_EXPIRING_SOON','MEMBERSHIP_EXPIRED'].map(type=>[type,{},'PAYMENT','/dashboard/membership'] as [string,Record<string,string>,string,string]),
  ['PAYMENT_DUE_SOON',{paymentId:'payment-1'},'PAYMENT','/dashboard/payments?paymentId=payment-1'],
  ...['INVOICE_METER_REMINDER','INVOICE_PAYMENT_REMINDER'].map(type=>[type,{contractId:'lease-1',invoiceId:'invoice-1'},'PAYMENT','/dashboard/invoices/lease-1?section=monthly&invoice=invoice-1'] as [string,Record<string,string>,string,string]),
  ...['TERMINATION_APPROVED','LEASE_RENEWAL_WINDOW_OPENED'].map(type=>[type,{contractId:'lease-1'},'CONTRACT','/dashboard/contracts/lease-1?tab=end'] as [string,Record<string,string>,string,string]),
  ['BOOKING_REMINDER',{bookingId:'booking-1',recipientSide:'RENTER'},'APPOINTMENT','/dashboard/viewing-schedules/my-bookings?appointmentId=booking-1'],
  ...complaints.flatMap(type=>['PARTY','ADMIN'].map(audience=>[type,{caseId:'case-1',rentalRequestId:'rental-1',audience},'RENTAL_REQUEST',audience==='ADMIN'?'/operations/complaints?caseId=case-1':'/dashboard/complaints?requestId=rental-1&complaintId=case-1'] as [string,Record<string,string>,string,string])),
  ...['SYSTEM_INCIDENT_OPENED','SYSTEM_INCIDENT_RESOLVED'].map(type=>[type,{incidentId:'incident-1',component:'BLOCKCHAIN'},'SYSTEM','/operations/system-alerts?incidentId=incident-1'] as [string,Record<string,string>,string,string]),
];
const event=(type:string,data:Record<string,unknown>,extra={})=>({eventId:'event-1',eventType:type,version:1,occurredAt:'2026-11-17T00:00:00.000Z',recipients:['persisted-recipient'],data,...extra});
const parse=(value:unknown)=>parseNotificationEvent(Buffer.from(JSON.stringify(value)));
describe('notification coverage completion contract',()=>{
  it.each(cases)('%s has a fixed route and safe minimal data', (type,data,category,route)=>{
    const rendered=renderNotification(parse(event(type,data)),'persisted-recipient');
    expect(rendered).toMatchObject({category,type,actionPath:route,recipientId:'persisted-recipient'});
    expect(rendered.title.length).toBeGreaterThan(0);expect(rendered.body.length).toBeGreaterThan(0);
    expect(rendered.body).not.toMatch(/PRIVATE|CCCD|https?:|RPC|bank|evidence/i);
  });
  it.each(cases)('%s rejects private fields, recipient fanout and unsafe identifiers',(type,data)=>{
    expect(()=>parse(event(type,{...data,reason:'PRIVATE'}))).toThrow();
    expect(()=>parse(event(type,data,{recipients:['a','b']}))).toThrow();
    for(const key of Object.keys(data).filter(key=>key.endsWith('Id'))){
      expect(()=>parse(event(type,{...data,[key]:'../another-user'}))).toThrow();
    }
  });
  it('distinguishes final complaint closure from the first conclusion and approval from effective termination',()=>{
    const complaint=(type:string)=>renderNotification(parse(event(type,{caseId:'case-1',rentalRequestId:'rental-1',audience:'PARTY'})),'persisted-recipient');
    expect(complaint('COMPLAINT_DECIDED').body).toContain('tiếp tục');
    expect(complaint('COMPLAINT_FINAL_DECISION').body).toContain('đóng hồ sơ');
    expect(renderNotification(parse(event('TERMINATION_APPROVED',{contractId:'lease-1'})),'persisted-recipient').body).toContain('sau khi');
  });
  it('rejects invented recipient roles and components',()=>{
    expect(()=>parse(event('COMPLAINT_OPENED',{caseId:'case-1',rentalRequestId:'rental-1',audience:'PUBLIC'}))).toThrow();
    expect(()=>parse(event('SYSTEM_INCIDENT_OPENED',{incidentId:'incident-1',component:'https://private'}))).toThrow();
  });
});
