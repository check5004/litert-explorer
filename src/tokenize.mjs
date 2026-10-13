/** Fixed model contract: preserve BOS/EOS, truncate only content, pad to 128. */
export function tokenize128(tokenizer,text){
 const full=tokenizer(text,{add_special_tokens:false,return_tensor:false,padding:false,truncation:false}).input_ids;
 const content=full.slice(0,126);const input_ids=[0,...content,2];const attention_mask=input_ids.map(()=>1);
 while(input_ids.length<128){input_ids.push(1);attention_mask.push(0)}
 return {input_ids,attention_mask,truncated:full.length>126,originalTokenCount:full.length+2};
}
