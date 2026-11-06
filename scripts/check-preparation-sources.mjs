import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareProject } from '../plugin/src/archives.ts';
import { DEFAULT_PROJECT_FOLDERS as folders } from '../plugin/src/settings.ts';
import { buildSceneContext } from '../plugin/src/scene-context.ts';
import { ChapterReview } from '../plugin/src/chapter-review.ts';
import { suppliedLinks, preparationSources } from '../plugin/src/preparation-sources.ts';
import { manualRole } from '../plugin/src/request-context.ts';
import { editorialObjectives, introducedObjectives, rateEditorialObjectives } from '../plugin/src/editorial-priorities.ts';

export async function checkPreparationSources(prompts) {
  const root = await mkdtemp(join(tmpdir(), 'orelius-documentation-'));
  const chapter = 'Manuscript/Chapters/001.md', character = 'Bible/Characters/Mina.md';
  const url = 'https://example.org/journal';
  const source = { url, statut: 'consultee', raison: 'Comprendre le choix professionnel de Mina.', extrait: 'Le chantier ferme en décembre.', publication: '2024-10-01' };
  try {
    await prepareProject(root, folders);
    await writeFile(join(root, chapter), 'Mina attend la décision du port.');
    await writeFile(join(root, 'Bible/Projet.md'), `Source proposée : [journal](${url}).`);
    const identity = '# Mina\n\n- [essentiel] Mina veut devenir capitaine.\n';
    await writeFile(join(root, character), identity);
    await mkdir(join(root, 'Bible/World'), { recursive: true });
    await writeFile(join(root, 'Bible/World/Port.md'), '# Port\n\nUn chantier naval.');
    const context = await buildSceneContext(root, folders, {}, chapter, 'Mina doit décider. Le Port est concerné.', prompts);
    assert.equal(context.sources.find(item => item.path === character)?.role, 'character-reference');
    assert.equal(context.sources.find(item => item.path === 'Bible/World/Port.md')?.role, 'world-reference');
    assert.equal(manualRole('Bible/Style/Mina.md', folders), 'style-reference');
    assert.equal(manualRole('Bible/World/Port.md', folders), 'world-reference');
    assert.deepEqual(suppliedLinks(context), [url]);
    assert.throws(() => preparationSources([], context), /omet des liens/);
    for (const invalid of [null, [source, source], [{ ...source, extrait: '' }], [{ ...source, statut: 'indisponible' }], [{ ...source, url: 'file:///etc/passwd' }], [{ ...source, raison: '' }]]) {
      assert.throws(() => preparationSources(invalid, context), /Documentez/);
    }
    assert.deepEqual(preparationSources([{ ...source, statut: 'indisponible', extrait: '', raison: 'HTTP 404' }], context)[0].statut, 'indisponible');
    const review = new ChapterReview();
    const args = { chemin: chapter, personnages: 'Mina veut devenir capitaine, mais ignore encore la fermeture. Source : Bible/Characters/Mina.md.', documentation: [source], objectifs: [], situation: 'Mina attend.', objectif: 'Choisir son engagement.', actions: ['Mina demande le calendrier.'], connaissances: 'Mina ne connaît pas la décision.', arrivee: 'Mina pose sa condition.', corrections: 'Une voix précise.', incertitudes: 'La date de la scène reste à fixer.' };
    await assert.rejects(review.prepare(root, folders, { ...args, personnages: '' }, context), /Préparez/);
    await assert.rejects(review.prepare(root, folders, { ...args, documentation: [] }, context), /omet des liens/);
    await review.prepare(root, folders, args, context);
    const saved = await readFile(join(root, context.preparationPath), 'utf8');
    assert.ok(saved.includes(args.personnages));
    assert.ok(saved.includes(source.extrait));
    assert.ok(saved.includes('Écriture : corrections'));
    const publication = await review.publicationInput(root, chapter, 'Mina exige une réponse.');
    const evidence = publication.contexte.sources.find(item => item.path === url);
    assert.equal(evidence.role, 'external-documentation');
    assert.ok(evidence.content.includes(source.extrait));
    assert.equal(context.sources.some(item => item.path === url), false, 'La source déclarée ne devient pas un fait canonique du contexte.');
    await assert.rejects(review.prepare(root, folders, { ...args, documentation: [] }, context));
    await assert.rejects(review.publicationInput(root, chapter, 'Brouillon'), /preparer_chapitre/);
    assert.deepEqual(introducedObjectives(character, '', identity, folders), []);
    await rateEditorialObjectives(root, folders, editorialObjectives(character, identity), { subject: 'reponse', value: 'down', report: 'avis.md', message: 'Prose plate.' });
    assert.equal(await readFile(join(root, character), 'utf8'), identity, 'Un rejet global ne note pas les ambitions du personnage.');
    assert.equal(await readFile(join(root, chapter), 'utf8'), 'Mina attend la décision du port.');
  } finally { await rm(root, { recursive: true, force: true }); }
}
