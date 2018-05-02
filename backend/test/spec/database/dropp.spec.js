const Log = require('../../logger');
const Dropp = require('../../../src/models/Dropp');
const Utils = require('../../../src/utilities/utils');
const Firebase = require('../../../src/firebase/firebase');
const DroppError = require('../../../src/errors/DroppError');
const DroppAccessor = require('../../../src/database/dropp');

/**
 * Logs a message for the current test files
 * @param {String} _title the describe label
 * @param {String|Object} _details the log details
 */
function log(_title, _details) {
  Log(`Dropp Accessor ${_title}`, _details);
}

Firebase.start(process.env.MOCK === '1');
const getDroppTitle = 'Get dropp';
/* eslint-disable no-undef */
describe(getDroppTitle, () => {
  beforeEach(async (done) => {
    this.testDropp = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    await DroppAccessor.add(this.testDropp);
    done();
  });

  afterEach(async (done) => {
    await DroppAccessor.remove(this.testDropp);
    delete this.testDropp;
    done();
  });

  it('throws an error for an invalid dropp ID', async (done) => {
    try {
      await DroppAccessor.get(null);
      expect(false).toBe(true);
      log(getDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(getDroppTitle, error.details);
    }

    done();
  });

  it('returns null for the forbidden dropp', async (done) => {
    const dropp = await DroppAccessor.get(DroppAccessor.forbiddenDroppId);
    expect(dropp).toBeNull();
    log(getDroppTitle, dropp);
    done();
  });

  it('returns null for a non-existent dropp', async (done) => {
    const dropp = await DroppAccessor.get(Utils.newUuid());
    expect(dropp).toBeNull();
    log(getDroppTitle, dropp);
    done();
  });

  it('returns a dropp for a valid ID', async (done) => {
    const dropp = await DroppAccessor.get(this.testDropp.id);
    expect(dropp).toBeDefined();
    expect(dropp).not.toBeNull();
    expect(dropp.id).toBe(this.testDropp.id);
    expect(dropp.text).toBe(this.testDropp.text);
    expect(dropp.media).toBe(this.testDropp.media);
    expect(dropp.location).toBe(this.testDropp.location);
    expect(dropp.username).toBe(this.testDropp.username);
    expect(dropp.timestamp).toBe(this.testDropp.timestamp);
    log(getDroppTitle, dropp);
    done();
  });
});

const getAllDroppsTitle = 'Get all dropps';
describe(getAllDroppsTitle, () => {
  beforeEach(async (done) => {
    this.testDropp = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    await DroppAccessor.add(this.testDropp);
    done();
  });

  afterEach(async (done) => {
    await DroppAccessor.remove(this.testDropp);
    delete this.testDropp;
    done();
  });

  it('returns all the dropps', async (done) => {
    const dropps = await DroppAccessor.getAll();

    // Check that array doesn't have invalid values
    expect(Array.isArray(dropps)).toBe(true);
    expect(dropps.includes(null)).toBe(false);
    expect(dropps.filter(dropp => dropp.id === DroppAccessor.forbiddenDroppId).length).toBe(0);

    // Check that array has expected value
    expect(dropps.filter(dropp => dropp.id === this.testDropp.id).length).toBe(1);
    log(getAllDroppsTitle, dropps.length);
    done();
  });
});

const createDroppTitle = 'Create dropp';
describe(createDroppTitle, () => {
  beforeEach(() => {
    this.testDropp = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });
  });

  afterEach(() => {
    delete this.testDropp;
  });

  it('throws an error for an invalid dropp object', async (done) => {
    try {
      await DroppAccessor.add(null);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for invalid text', async (done) => {
    this.testDropp.text = false;
    try {
      await DroppAccessor.add(this.testDropp);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('text');
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for invalid media', async (done) => {
    this.testDropp.media = 1;
    try {
      await DroppAccessor.add(this.testDropp);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('media');
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for an invalid location', async (done) => {
    this.testDropp.location = 1;
    try {
      await DroppAccessor.add(this.testDropp);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('location');
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for an invalid username', async (done) => {
    this.testDropp.username = 1;
    try {
      await DroppAccessor.add(this.testDropp);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('username');
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for an invalid timestamp', async (done) => {
    this.testDropp.timestamp = false;
    try {
      await DroppAccessor.add(this.testDropp);
      expect(false).toBe(true);
      log(createDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('timestamp');
      log(createDroppTitle, error.details);
    }

    done();
  });

  it('adds a dropp to the database for a valid dropp', async (done) => {
    const result = await DroppAccessor.add(this.testDropp);
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result).toBe(this.testDropp);
    done();
  });
});

const updateDroppTitle = 'Update dropp';
describe(updateDroppTitle, () => {
  beforeEach(async (done) => {
    this.testDropp = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    await DroppAccessor.add(this.testDropp);
    done();
  });

  afterEach(async (done) => {
    await DroppAccessor.remove(this.testDropp);
    delete this.testDropp;
    done();
  });

  it('throws an error for an invalid dropp object', async (done) => {
    try {
      await DroppAccessor.updateText(null, 'test');
      expect(false).toBe(true);
      log(updateDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(updateDroppTitle, error.details);
    }

    done();
  });

  it('throws an error for invalid text', async (done) => {
    try {
      await DroppAccessor.updateText(this.testDropp, null);
      expect(false).toBe(true);
      log(updateDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.InvalidRequest.type);
      expect(error.details.error.message).toBeDefined();
      expect(typeof error.details.error.message).toBe('string');

      const invalidParameters = error.details.error.message.split(',');
      expect(invalidParameters.length).toBe(1);
      expect(invalidParameters[0]).toBe('text');
      log(updateDroppTitle, error.details);
    }

    done();
  });

  it('updates the text for valid text', async (done) => {
    const oldText = this.testDropp.text;
    const newText = Utils.newUuid();
    await DroppAccessor.updateText(this.testDropp, newText);
    expect(this.testDropp.text).not.toBe(oldText);
    expect(this.testDropp.text).toBe(newText);
    log(updateDroppTitle, this.testDropp.text);
    done();
  });
});

const removeDroppTitle = 'Remove dropp';
describe(removeDroppTitle, () => {
  beforeEach(async (done) => {
    this.testDropp = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    await DroppAccessor.add(this.testDropp);
    done();
  });

  afterEach(async (done) => {
    if (this.testDropp) {
      await DroppAccessor.remove(this.testDropp);
      delete this.testDropp;
    }

    done();
  });

  it('throws an error for an invalid dropp object', async (done) => {
    try {
      await DroppAccessor.remove(null);
      expect(false).toBe(true);
      log(removeDroppTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(removeDroppTitle, error.details);
    }

    done();
  });

  it('removes a dropp from the database', async (done) => {
    await DroppAccessor.remove(this.testDropp);
    const result = await DroppAccessor.get(this.testDropp.id);
    expect(result).toBeNull();
    log(removeDroppTitle, result);

    // Clean up
    delete this.testDropp;
    done();
  });
});

const bulkRemoveTitle = 'Bulk remove dropps';
describe(bulkRemoveTitle, () => {
  beforeEach(async (done) => {
    this.testDropp1 = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    this.testDropp2 = new Dropp({
      location: '0,0',
      media: 'false',
      text: 'test',
      timestamp: 1,
      username: 'test',
    });

    await DroppAccessor.add(this.testDropp1);
    await DroppAccessor.add(this.testDropp2);
    done();
  });

  afterEach(async (done) => {
    if (this.testDropp1) {
      await DroppAccessor.remove(this.testDropp1);
      delete this.testDropp1;
    }

    if (this.testDropp2) {
      await DroppAccessor.remove(this.testDropp2);
      delete this.testDropp2;
    }

    done();
  });

  it('throws an error for an invalid dropp list object', async (done) => {
    try {
      await DroppAccessor.bulkRemove(null);
      expect(false).toBe(true);
      log(bulkRemoveTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(bulkRemoveTitle, error.details);
    }

    done();
  });

  it('throws an error for an invalid dropp inside a valid list object', async (done) => {
    const dropps = [this.testDropp1, null];
    try {
      await DroppAccessor.bulkRemove(dropps);
      expect(false).toBe(true);
      log(bulkRemoveTitle, 'Should have thrown error');
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.name).toBe('DroppError');
      expect(error.details).toBeDefined();
      expect(error.details.error).toBeDefined();
      expect(error.details.error.type).toBe(DroppError.type.Server.type);
      expect(error.details.error.message).toBeDefined();
      expect(error.details.error.message).toBe(DroppError.type.Server.message);
      log(bulkRemoveTitle, error.details);
    }

    done();
  });

  it('removes multiple dropps from the database at once', async (done) => {
    const dropps = [this.testDropp1, this.testDropp2];
    await DroppAccessor.bulkRemove(dropps);
    const dropp1 = await DroppAccessor.get(this.testDropp1.id);
    const dropp2 = await DroppAccessor.get(this.testDropp2.id);
    expect(dropp1).toBeNull();
    expect(dropp2).toBeNull();
    log(bulkRemoveTitle, [dropp1, dropp2]);

    // Clean up
    delete this.testDropp1;
    delete this.testDropp2;
    done();
  });

  it('does not throw an error for a dropp without an ID', async (done) => {
    const originalId = this.testDropp1.id;
    this.testDropp1.id = null;
    const dropps = [this.testDropp1];
    await DroppAccessor.bulkRemove(dropps);
    const result = await DroppAccessor.get(originalId);
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result.id).toBe(originalId);
    log(bulkRemoveTitle, result);

    // Clean up
    this.testDropp1.id = originalId;
    done();
  });
});
/* eslint-enable no-undef */
