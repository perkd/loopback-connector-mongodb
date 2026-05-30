#!/usr/bin/env node
'use strict'

/**
 * Smoke test: findOrCreate must coerce mongodb.dataType ObjectID via toDatabase.
 * Run from repo root:
 *   NODE_PATH=../service_CRM/membership/node_modules node scripts/smoke-findorcreate-objectid.js
 */
const assert = require('node:assert/strict')
const {promisify} = require('node:util')
const juggler = require('loopback-datasource-juggler')

const connector = require('..')
const objectIDLikeString = '7cd2ad46ffc580ba45d3cb1f'

async function main() {
	const ds = new juggler.DataSource(connector, {
		host: process.env.MONGODB_HOST || '127.0.0.1',
		port: process.env.MONGODB_PORT || 27017,
		database: `lb-foc-objectid-smoke-${process.pid}`,
	})

	await promisify(ds.connector.connect.bind(ds.connector))()

	const Member = ds.createModel(
		'MemberFOC',
		{
			personId: {type: String, mongodb: {dataType: 'objectid'}},
			title: String,
		},
		{strictObjectIDCoercion: true},
	)

	await promisify(Member.deleteAll.bind(Member))()

	const filter = {where: {personId: objectIDLikeString}}
	const data = {personId: objectIDLikeString, title: 'member-foc'}
	const [createdInst, created] = await Member.findOrCreate(filter, data)

	assert.strictEqual(created, true)

	const findOne = promisify(ds.connector.execute.bind(ds.connector, 'MemberFOC', 'findOne'))
	const raw = await findOne({_id: {$eq: createdInst.id}}, {safe: true})
	assert.ok(raw.personId instanceof ds.ObjectID, 'inserted personId must be BSON ObjectId')

	const [foundInst, createdAgain] = await Member.findOrCreate(filter, data)
	assert.strictEqual(createdAgain, false)
	assert.strictEqual(String(foundInst.id), String(createdInst.id))
	assert.strictEqual(await Member.count({personId: objectIDLikeString}), 1)

	await promisify(ds.connector.disconnect.bind(ds.connector))()
	console.log('PASS findOrCreate ObjectID coercion')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
