const automaticPublicPathSnippet =
  'if(!e)throw new Error("Automatic publicPath is not supported in this browser");e=e.replace(/#.*$/,"").replace(/\\?.*$/,"").replace(/\\/[^\\/]+$/,"/"),__webpack_require__.p=e'
const moduleInitSnippet = 'this.ready=this.#e(e,r,{onrunprocess:t,...a});'
const moduleInitPatched = 'this.ready=this.#e(e,r,a);'
const emceptionExposeSnippet = 'globalThis.emception=Hn,i(Hn)'
const emceptionExposePatched = 'Hn.mkdir=async e=>{await Hn.fileSystem.mkdir(e)};globalThis.emception=Hn,i(Hn)'

export const patchEmceptionWorkerSource = (source) => {
  if (!source.includes(automaticPublicPathSnippet)) {
    throw new Error('emception worker format changed; update fetch-emception-worker.mjs')
  }
  if (!source.includes(moduleInitSnippet)) {
    throw new Error('emception worker init format changed; update fetch-emception-worker.mjs')
  }
  if (!source.includes(emceptionExposeSnippet)) {
    throw new Error('emception worker export format changed; update fetch-emception-worker.mjs')
  }

  return source
    .replace(/e\.exports=t\.p\+"([^"]+)\.br"/g, 'e.exports=t.p+"$1.brotli"')
    .replace(
      automaticPublicPathSnippet,
      '__webpack_require__.p=new URL("./",self.location.href).href',
    )
    .replace(moduleInitSnippet, moduleInitPatched)
    .replace(emceptionExposeSnippet, emceptionExposePatched)
}
