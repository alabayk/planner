export function installTrafficBudget({now=()=>Date.now()}={}){
  let economy=false,lastAutomatic=0;
  document.addEventListener('planner-traffic',event=>{
    const data=event.detail;if(!data||!Number.isFinite(data.bytes))return;economy=!!data.economy;
    let node=document.getElementById('trafficWarning');
    if(!node){node=document.createElement('section');node.id='trafficWarning';node.className='sessionNotice';node.setAttribute('role','status');document.getElementById('offline').after(node);}
    node.hidden=!data.warning;
    node.textContent=`Учтённый трафик: ${(data.bytes/1e9).toFixed(2)} ГБ. ${economy?'Экономичный режим: фоновые проверки раз в 15 минут. Уведомления о дедлайнах работают.':'Расход повышен. Следите за лимитом в панели хостинга.'} Это оценка приложения, не счётчик TatNet. Ручное обновление доступно.`;
  });
  return {allowAutomatic(){if(economy&&now()-lastAutomatic<15*60000)return false;lastAutomatic=now();return true;}};
}
