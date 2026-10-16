from flask import request

def query_account(cursor):
    name = request.args.get('name')
    # Unsafe raw execution with string formatting
    cursor.execute("SELECT * FROM accounts WHERE name = '%s'" % name)
    return cursor.fetchall()
