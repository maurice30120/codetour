import os,sys,json,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2]; d=pathlib.Path(__file__).resolve().parent
run,mode=sys.argv[1:3]; rd=d/'runs'/run; rd.mkdir(exist_ok=True)
env={k:v for k,v in os.environ.items() if not k.startswith(('TE_','TOKENECONOMIZER_'))}
env.update(PI_CODING_AGENT_DIR=str(d/'pi'),PI_OFFLINE='1',PI_TELEMETRY='0',TOKENECONOMIZER_HOME=str(d/mode),TE_HISTORY_IMPORT='off',TE_TOOLPRUNE='off',TE_LOOPGUARD='off',TE_REPOMAP='off',TE_PI_PAID_MODEL='mistral/deepseek-v4-1-flash-1017',TE_PI_CLI=str(d/'pi-capture'),CAMPAIGN_DIR=str(d),TERM='xterm-256color')
cmd=['rtk',str(root/'launch-local.sh'),'pi','--memory='+mode,'--model','mistral/deepseek-v4-1-flash-1017','--thinking',os.environ.get('CAMPAIGN_THINKING','off'),'--session-dir',str(d/'sessions'),'--name',d.name+'-'+run,'--no-prompt-templates','--no-mcp','--append-system-prompt','Campagne de mesure : préserve les sources et les artefacts existants. Ne lis ni les données privées .campaigns/ ni les Tours existants. Tu peux écrire une proposition dans /tmp puis créer exactement un Tour via le CLI.']
(rd/'command.json').write_text(json.dumps(cmd,indent=2));(rd/'environment.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith(('TE_','TOKENECONOMIZER_','PI_'))},indent=2)); (rd/'start.json').write_text(json.dumps({'time':time.time(),'mode':mode}))
r=subprocess.run(['script','-q',str(rd/'terminal.raw'),*cmd],env=env,cwd=root)
(rd/'end.json').write_text(json.dumps({'time':time.time(),'exit_code':r.returncode}))
