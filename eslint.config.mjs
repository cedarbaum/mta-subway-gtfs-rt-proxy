import js from '@eslint/js'
import globals from 'globals'

export default [
	js.configs.recommended,
	// > Note: there should be no other properties in this object
	// https://eslint.org/docs/latest/use/configure/migration-guide#ignoring-files
	{
		ignores: [
			'postgis-gtfs-importer',
			'lib/mta-gtfs-realtime.pb.js',
		],
	},
	{
		languageOptions: {
			sourceType: 'module',
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
		},
		rules: {
			'no-unused-vars': [
				'warn',
				{
					vars: 'all',
					args: 'none',
					ignoreRestSiblings: false,
				},
			],
		},
	},
]
