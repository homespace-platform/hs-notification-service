import { jest } from '@jest/globals';
import { parseNotificationEvent, renderNotification } from './notification-event';
import { NotificationService } from '../notification/application/notification.service';
import { InMemoryNotificationRepository, InMemoryPreferenceRepository } from '../notification/testing/in-memory-notification.repository';
import { NotificationRealtimeService } from '../notification-realtime/notification-realtime.service';

const types=['MEMBERSHIP_ACTIVATED','MEMBERSHIP_PAYMENT_REVIEW'];
const orderId='cb856b215fbf4d33b7f7fd54d5ce7867';
const input=(type=types[0], overrides:Record<string,unknown>={})=>({eventId:'membership-transition',eventType:type,version:1,
  occurredAt:'2026-11-14T00:00:00.000Z',recipients:['order-owner'],data:{orderId},...overrides});
const parse=(value:unknown)=>parseNotificationEvent(Buffer.from(JSON.stringify(value)));
describe('membership notification acceptance',()=>{
  it.each(types)('%s uses a membership order identity and fixed authorized detail path',type=>{
    const item=renderNotification(parse(input(type)),'order-owner');
    expect(item).toMatchObject({category:'PAYMENT',priority:'NORMAL',type,recipientId:'order-owner',
      actionPath:`/dashboard/membership/return?orderId=${orderId}`,metadata:{orderId}});
    expect(item.body).not.toMatch(/VND|ETH|SePay|hoàn tiền|chưa được kích hoạt/);
    if(type==='MEMBERSHIP_PAYMENT_REVIEW')expect(item.body).toContain('đối soát');
  });
  it.each(['amount','amountVnd','tier','provider','status','paidAt','paymentId','ownerId','wallet','txHash','reason','url','actionPath','__proto__'])
    ('rejects extra membership data %s',key=>{
      for(const type of types){const data=JSON.parse(JSON.stringify({orderId}).slice(0,-1)+`,"${key}":"private"}`) as Record<string,string>;
        expect(()=>parse(input(type,{data}))).toThrow('Invalid notification event');}
    });
  it.each([null,'',42,'../order','a/b','x'.repeat(201)])('rejects invalid orderId %j',id=>{
    expect(()=>parse(input(types[0],{data:{orderId:id}}))).toThrow('Invalid notification event');
  });
  it.each([{data:{}},{recipients:[]},{recipients:['a','b']},{recipients:['a','a']},{version:2},{eventType:'MEMBERSHIP_FAILED'}])
    ('rejects malformed membership envelope %j',overrides=>expect(()=>parse(input(types[0],overrides))).toThrow('Invalid notification event'));
  it.each(['PAYMENT_SUCCESSFUL','PAYMENT_FAILED','PAYMENT_OVERDUE'])('preserves old paymentId schema for %s',type=>{
    expect(()=>parse(input(type))).toThrow('Invalid notification event');
    const item=renderNotification(parse(input(type,{data:{paymentId:'payment-1'}})),'order-owner');
    expect(item.actionPath).toBe('/notifications');expect(item.metadata).toEqual({paymentId:'payment-1'});
  });
  it('activation then review are distinct historical outcomes and replay is idempotent per owner',async()=>{
    const emitNew=jest.fn<NotificationRealtimeService['emitNew']>();
    const service=new NotificationService(new InMemoryNotificationRepository(),new InMemoryPreferenceRepository(),undefined,
      {emitNew,emitUnreadCount:jest.fn()} as unknown as NotificationRealtimeService);
    for(const [i,type]of types.entries()){
      const item=renderNotification(parse(input(type,{eventId:`membership-${i}`})),'order-owner');
      const first=await service.create(item);expect((await service.create(item)).notification.id).toBe(first.notification.id);
      await expect(service.markRead('stranger',first.notification.id)).rejects.toThrow();
      await expect(service.delete('stranger',first.notification.id)).rejects.toThrow();
    }
    expect(emitNew).toHaveBeenCalledTimes(2);expect(emitNew.mock.calls.every(call=>call[0]==='order-owner')).toBe(true);
    expect((await service.getFeed('order-owner',{category:'PAYMENT'})).items).toHaveLength(2);
    expect((await service.getFeed('stranger',{})).items).toEqual([]);
    await service.updatePreferences('order-owner',[{category:'PAYMENT',push:false,email:false}]);
    expect((await service.getPreferences('order-owner')).find(p=>p.category==='PAYMENT')?.push).toBe(false);
    expect((await service.getFeed('order-owner',{})).items).toHaveLength(2);
  });
});
