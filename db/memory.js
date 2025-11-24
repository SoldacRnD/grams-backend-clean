class MemoryDB {
  constructor(){
    this.grams = {}
    this.perks = {}
    this.redemptions = []
  }
  createGram({id,title,image_url}){
    const g={id,title,image_url,created_at:Date.now(),owner_id:null}
    this.grams[id]=g; this.perks[id]=[]; return g
  }
  getGram(id){ return this.grams[id]||null }
  setOwner(id,ownerId){ if(!this.grams[id])return null; this.grams[id].owner_id=ownerId; return this.grams[id] }
  getGramsByOwner(ownerId){ return Object.values(this.grams).filter(g=>String(g.owner_id)===String(ownerId)).map(g=>({...g,perks:this.perks[g.id]})) }
  addPerk(id,p){ this.perks[id].push(p); return p }
}
module.exports = MemoryDB
