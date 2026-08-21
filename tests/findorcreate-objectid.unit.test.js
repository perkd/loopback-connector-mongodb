'use strict'

const {describe, it} = require('node:test')
const assert = require('node:assert/strict')
const mongodb = require('mongodb')
const {MongoDB} = require('../lib/mongodb')

const objectIDLikeString = '7cd2ad46ffc580ba45d3cb1f'

function makeConnector() {
	const dataSource = {
		modelBuilder: {definitions: {}},
		idName: () => 'id',
		idNames: () => ['id'],
	}
	const connector = new MongoDB({}, dataSource)
	connector.dataSource = dataSource
	connector._models = {
		MemberFOC: {
			model: {
				dataSource,
				getConnector: () => connector,
			},
			properties: {
				id: {type: String, id: true, generated: true, mongodb: {dataType: 'ObjectID'}},
				personId: {type: String, mongodb: {dataType: 'objectid'}},
				title: {type: String},
			},
			settings: {},
		},
	}
	return connector
}

describe('findOrCreate ObjectID coercion (unit)', function() {
	it('calls toDatabase before $setOnInsert', () => {
		const connector = makeConnector()
		let toDatabaseCalled = false
		const origToDatabase = connector.toDatabase.bind(connector)

		connector.toDatabase = function(modelName, data) {
			toDatabaseCalled = true
			return origToDatabase(modelName, data)
		}

		connector.buildWhere = () => ({personId: new mongodb.ObjectId(objectIDLikeString)})
		connector.buildSort = () => undefined
		connector.fromDatabase = (_, data) => data
		connector.setIdValue = (_, data, id) => { data.id = id.toString() }

		connector.execute = function(modelName, command, query, update, options, cb) {
			assert.strictEqual(command, 'findOneAndUpdate')
			assert.ok(update.$setOnInsert.personId instanceof mongodb.ObjectId)
			cb(null, {
				value: {_id: new mongodb.ObjectId(), personId: update.$setOnInsert.personId, title: 'x'},
				lastErrorObject: {updatedExisting: false},
			})
		}

		return new Promise((resolve, reject) => {
			connector.findOrCreate(
				'MemberFOC',
				{where: {personId: objectIDLikeString}},
				{personId: objectIDLikeString, title: 'x'},
				{},
				(err, value, created) => {
					if (err) return reject(err)
					try {
						assert.strictEqual(toDatabaseCalled, true)
						assert.strictEqual(created, true)
						resolve()
					}
					catch (e) { reject(e) }
				},
			)
		})
	})

	it('toDatabase coerces personId string to ObjectId', () => {
		const connector = makeConnector()
		const data = {personId: objectIDLikeString, title: 'x'}
		const coerced = connector.toDatabase('MemberFOC', {...data})

		assert.ok(coerced.personId instanceof mongodb.ObjectId)
		assert.strictEqual(typeof data.personId, 'string')
	})
})
