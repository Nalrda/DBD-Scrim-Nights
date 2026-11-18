import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {Client,GatewayIntentBits,ChannelType,PermissionFlagsBits} from 'discord.js';
import {buildForumPosts,AUTO_MARKER} from './render.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const json=JSON.parse(await readFile(resolve(root,'DBD Scrim Nights.json'),'utf8'));
const catalogue=JSON.parse(await readFile(resolve(root,'forum/catalogue.json'),'utf8'));
const {posts,warnings}=buildForumPosts(json,catalogue);
const publish=process.argv.includes('--publish');
if(process.argv.some(x=>!['--publish','--dry-run'].includes(x)))throw Error('Usage: npm run forum:preview OR npm run forum:publish');
console.log(`${json.Name}: ${posts.length} posts (${json.KillerOverride.length} killer entries)`);
const preview=posts.map(p=>`# ${p.name}\n${p.parts.join('\n\n---\n\n')}\n`).join('\n\n');
await writeFile(resolve(root,'forum-preview.md'),preview);
console.log('Preview written to forum-preview.md');
if(warnings.length){
 console.warn(`WARNING: ${warnings.length} catalogue IDs could not be resolved; they are printed as IDs, not guessed:\n${warnings.join('\n')}`);
}
if(!publish){
 console.log('Dry run only. Nothing was sent to Discord. Use npm run forum:publish to publish.');
 process.exit(0);
}
if(warnings.length&&!process.env.ALLOW_UNMAPPED_BALANCE_IDS)throw Error('Unresolved item/perk/add-on names; review preview and set ALLOW_UNMAPPED_BALANCE_IDS=1 to publish with labeled IDs.');
const token=process.env.DISCORD_TOKEN,forumId=process.env.DISCORD_BALANCE_FORUM_ID;
if(!token||!/^\d{15,22}$/.test(forumId||''))throw Error('Set DISCORD_TOKEN and DISCORD_BALANCE_FORUM_ID in environment.');
const bot=new Client({intents:[GatewayIntentBits.Guilds]});
async function fetchAllThreads(forum){
 const all=new Map();
 const collect=coll=>{for(const thread of coll.values())if(thread.parentId===forum.id)all.set(thread.id,thread);};
 collect((await forum.threads.fetchActive()).threads);
 // The first 100 archived forum threads are sufficient for 51 canonical posts.
 const archived=await forum.threads.fetchArchived({type:'public',limit:100});
 collect(archived.threads);
 if(archived.hasMore)throw Error('Forum contains >100 archived posts. Stop to prevent duplicate publishing; add pagination before continuing.');
 return [...all.values()];
}
function starter(p){return `📚 **${p.name}**\nDBD Scrim Nights Balance • source: ${json.Name}\nThe detailed rules are posted below in bot-authored messages.\n${AUTO_MARKER} ${p.key}`;}
function detail(p,index){return `${AUTO_MARKER} ${p.key} / ${index+1} of ${p.parts.length}\n${p.parts[index]}`;}
function isOwnedAuto(m,p){return m.author?.id===bot.user.id&&m.content?.startsWith(`${AUTO_MARKER} ${p.key} /`);}
async function reconcile(thread,p){
 if(thread.archived)await thread.setArchived(false,'Refresh balance rules');
 const opening=await thread.fetchStarterMessage();
 if(!opening||opening.author.id!==bot.user.id||!opening.content.includes(`${AUTO_MARKER} ${p.key}`))throw Error(`Refusing to overwrite non-owned or non-canonical starter for ${p.name}`);
 const wantStarter=starter(p);
 if(opening.content!==wantStarter)await opening.edit(wantStarter);
 const history=await thread.messages.fetch({limit:100});
 if(history.size===100)throw Error(`Thread ${p.name} has 100+ recent messages; stopping to avoid unsafe cleanup`);
 const old=[...history.values()].filter(m=>isOwnedAuto(m,p)).sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
 const desired=p.parts.map((_,i)=>detail(p,i));
 if(old.length===desired.length&&old.every((m,i)=>m.content===desired[i])){
  console.log('UNCHANGED',p.name);return;
 }
 // Delete ONLY our own auto-generated replies. Never touch player discussion or moderator posts.
 for(const m of old)await m.delete();
 for(const content of desired)await thread.send({content,allowedMentions:{parse:[]}});
 console.log('SYNCED',p.name,desired.length,'detail messages');
}
try{
 await bot.login(token);
 const forum=await bot.channels.fetch(forumId);
 if(!forum||forum.type!==ChannelType.GuildForum)throw Error('DISCORD_BALANCE_FORUM_ID must identify an existing Discord Forum channel');
 const me=await forum.guild.members.fetchMe();
 const perms=forum.permissionsFor(me);
 for(const flag of ['ViewChannel','SendMessages','SendMessagesInThreads','ReadMessageHistory','ManageThreads']){
  if(!perms?.has(PermissionFlagsBits[flag]))throw Error('Missing Discord permission in forum: '+flag);
 }
 const threads=await fetchAllThreads(forum);
 for(const p of posts){
  const byMarker=threads.filter(t=>t.name===p.name);
  if(byMarker.length>1)throw Error('Multiple threads named '+p.name+'. Reconcile duplicates before publishing.');
  if(byMarker.length===1){
   await reconcile(byMarker[0],p);
  }else{
   const thread=await forum.threads.create({
    name:p.name,
    message:{content:starter(p),allowedMentions:{parse:[]}},
    reason:'DBD Scrim Nights balance publication'
   });
   threads.push(thread);
   console.log('CREATED',p.name,thread.id);
   await reconcile(thread,p);
  }
 }
 console.log('DONE: forum now reflects the balance JSON.');
}finally{bot.destroy();}
