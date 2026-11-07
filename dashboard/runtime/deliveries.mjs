import {RuntimeError, nonempty} from './errors.mjs';
export function deliveryInput(input) {
  if (Object.keys(input).some(k=>!['idempotency_key','task_id','attempt_id','kind','content','metadata','source','epoch','wake_supervisor'].includes(k)))
    throw new RuntimeError(400,'runtime/invalid-delivery','Unknown delivery field');
  if(input.wake_supervisor!==undefined&&typeof input.wake_supervisor!=='boolean')
    throw new RuntimeError(400,'runtime/invalid-delivery','wake_supervisor must be a boolean');
  if(input.source!=='fleet'||!Number.isSafeInteger(input.epoch)||input.epoch<1)
    throw new RuntimeError(400,'runtime/invalid-delivery-source','Delivery requires source fleet and an integer epoch >= 1');
  for(const key of ['idempotency_key','task_id','attempt_id'])nonempty(input[key],key,200);
  if(!['result','question','notice'].includes(input.kind)||typeof input.content!=='string'||!input.content.trim()||input.content.length>200000)
    throw new RuntimeError(400,'runtime/invalid-delivery','Delivery requires a kind and bounded nonempty content');
  const metadata=input.metadata===undefined?{}:input.metadata;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new RuntimeError(400,'runtime/invalid-delivery-metadata','metadata must be a bounded JSON object');
  function inspect(value,depth=0){
    if(depth>8)throw new RuntimeError(400,'runtime/invalid-delivery-metadata','metadata nesting exceeds its bound');
    if(value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
    if(typeof value==='string'&&value.length<=4096)return;
    if(Array.isArray(value)&&value.length<=100){for(const item of value)inspect(item,depth+1);return;}
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length<=100){
      for(const [key,item]of Object.entries(value)){
        if(['__proto__','__jsExpr','constructor','prototype'].includes(key)||key.length>200)throw new RuntimeError(400,'runtime/invalid-delivery-metadata','Reserved metadata key');
        inspect(item,depth+1);
      }return;
    }
    throw new RuntimeError(400,'runtime/invalid-delivery-metadata','metadata must contain bounded JSON values');
  }
  inspect(metadata);
  if(Buffer.byteLength(JSON.stringify(metadata))>16384)throw new RuntimeError(413,'runtime/delivery-metadata-too-large','metadata exceeds 16 KiB');
  return {source:input.source,epoch:input.epoch,idempotency_key:input.idempotency_key,task_id:input.task_id,attempt_id:input.attempt_id,kind:input.kind,content:input.content,metadata,...(input.wake_supervisor?{wake_supervisor:true}:{})};
}
export function deliveryReceipt(record,sessionId){return {delivery_id:record.id,session_id:sessionId,idempotency_key:record.idempotency_key,source:record.source,epoch:record.epoch,task_id:record.task_id,attempt_id:record.attempt_id,accepted:true,durable:true,status:'persisted'};}
