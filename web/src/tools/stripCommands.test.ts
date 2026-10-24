/**
 * The object commands of the strip (layout 3.0, L-4): one rule table for Del, +, −, arrange and its
 * settings. The strip renders the tooltips from it, the key handler runs the same actions, and the
 * object list lost its copies – so the table is tested here once instead of in three places.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_KEYS, COMMAND_LABELS, commandDisabled, commandReason, commandTitle, type CommandFacts } from './stripCommands';
import { TOOLS, toolTitle } from './registry';

const facts = (patch: Partial<CommandFacts> = {}): CommandFacts => ({ selected: 1, instances: 2, objects: 2, ...patch });

test('with one object selected every command can run', () => {
  assert.deepEqual(commandDisabled(facts()), {
    deleteSelection: false,
    addInstance: false,
    removeInstance: false,
    arrange: false,
    arrangeSettings: false,
  });
});

test('an empty plate disables arrange and its settings; nothing else is about the plate', () => {
  assert.deepEqual(commandDisabled(facts({ selected: 0, instances: 0, objects: 0 })), {
    deleteSelection: true,
    addInstance: true,
    removeInstance: true,
    arrange: true,
    arrangeSettings: true,
  });
  assert.equal(commandReason('arrange', facts({ selected: 0, instances: 0, objects: 0 })), 'load an object first');
});

test('a multi-selection can be deleted and arranged, but instances need exactly one object', () => {
  const multi = facts({ selected: 2, instances: 0 });
  assert.equal(commandDisabled(multi).deleteSelection, false);
  assert.equal(commandDisabled(multi).arrange, false);
  assert.equal(commandDisabled(multi).addInstance, true);
  assert.equal(commandDisabled(multi).removeInstance, true);
  assert.equal(commandReason('addInstance', multi), 'select one object');
});

test('the last instance is not removed – the object would silently disappear', () => {
  const one = facts({ instances: 1 });
  assert.equal(commandDisabled(one).removeInstance, true);
  assert.equal(commandReason('removeInstance', one), 'the object has one instance');
  assert.equal(commandDisabled(facts({ instances: 2 })).removeInstance, false);
});

test('the tooltips carry the name and the key, and the reason once the command cannot run', () => {
  assert.equal(commandTitle('arrange', facts()), 'Arrange (A)');
  assert.equal(commandTitle('deleteSelection', facts()), 'Delete selection (Del)');
  assert.equal(commandTitle('arrangeSettings', facts()), 'Arrange settings');
  assert.equal(commandTitle('addInstance', facts({ selected: 0 })), 'Add instance (+): select an object first');
  assert.equal(commandTitle('addInstance', facts({ selected: 2 })), 'Add instance (+): select one object');
});

test('every command has a name, an icon key and – except the gear – a shortcut key', () => {
  for (const command of Object.keys(COMMAND_LABELS) as Array<keyof typeof COMMAND_LABELS>) {
    assert.ok(COMMAND_LABELS[command].trim().length > 0, `${command} has a name`);
    if (command !== 'arrangeSettings') assert.ok(COMMAND_KEYS[command].length > 0, `${command} has a key`);
  }
});

test('a tool tooltip is built from its registry entry: name, last key, then the reason', () => {
  const cut = TOOLS.find((t) => t.id === 'cut');
  assert.ok(cut);
  assert.equal(toolTitle(cut.title, cut.shortcut?.keys), 'Cut (C)');
  assert.equal(toolTitle(cut.title, cut.shortcut?.keys, 'Select one object'), 'Cut (C): Select one object');
  assert.equal(toolTitle('Arrange', undefined), 'Arrange');
});
