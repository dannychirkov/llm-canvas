import { describe, it } from "node:test"
import assert from "node:assert/strict"
/**
 * Tests for contextService.ts
 * Check correctness of context assembly from node graph
 */

import { assembleContext } from '../contextService'
import type { Node, Edge } from 'reactflow'

describe('assembleContext', () => {
  // Test scenario: TextNode -> OpenAI Node
  it('должен собирать контекст из цепочки TextNode -> OpenAI Node', () => {
    const nodes: Node[] = [
      {
        id: 'text-1',
        type: 'text',
        data: {
          textContent: 'Привет, как дела?',
          hidden: false
        }
      },
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: 'Ответь на вопрос пользователя',
          responseText: 'Привет! У меня все хорошо, спасибо!',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'text-1',
        target: 'openai-1'
      }
    ]

    const result = assembleContext('openai-1', nodes, edges)
    
    // Expected result should contain:
    // 1. Text Input from parent node
    // 2. User/Assistant from target node
    const expectedParts = [
      'Text Input: Привет, как дела?',
      'User: Ответь на вопрос пользователя',
      'Assistant: Привет! У меня все хорошо, спасибо!'
    ]
    
    expectedParts.forEach(part => {
      assert.ok((result).includes(part))
    })
  })

  // Test scenario with MemoryNode
  it('должен включать MemoryNode в начало контекста', () => {
    const nodes: Node[] = [
      {
        id: 'memory-1',
        type: 'memory',
        data: {
          value: 'Пользователь предпочитает формальный стиль общения',
          hidden: false
        }
      },
      {
        id: 'text-1',
        type: 'text',
        data: {
          textContent: 'Расскажи о погоде',
          hidden: false
        }
      },
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: 'Ответь на вопрос',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'text-1',
        target: 'openai-1'
      }
    ]

    const result = assembleContext('openai-1', nodes, edges)
    
    // MemoryNode should be at the beginning
    assert.ok((result).includes('Persistent Memory: Пользователь предпочитает формальный стиль общения'))
    assert.ok((result).includes('Text Input: Расскажи о погоде'))
    assert.ok(!(result).includes('User: Ответь на вопрос'))
  })

  // Test scenario with hidden nodes
  it('должен игнорировать скрытые узлы', () => {
    const nodes: Node[] = [
      {
        id: 'text-1',
        type: 'text',
        data: {
          textContent: 'Скрытый текст',
          hidden: true  // Hidden node
        }
      },
      {
        id: 'text-2',
        type: 'text',
        data: {
          textContent: 'Видимый текст',
          hidden: false
        }
      },
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: 'Ответь на вопрос',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'text-1',
        target: 'openai-1'
      },
      {
        id: 'edge-2',
        source: 'text-2',
        target: 'openai-1'
      }
    ]

    const result = assembleContext('openai-1', nodes, edges)
    
    // Hidden node should not be included
    assert.ok(!(result).includes('Скрытый текст'))
    // Visible node should be included
    assert.ok((result).includes('Text Input: Видимый текст'))
  })

  // Test scenario with chain of LLM nodes
  it('должен правильно обрабатывать цепочку LLM узлов', () => {
    const nodes: Node[] = [
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: 'Первый вопрос',
          responseText: 'Первый ответ',
          hidden: false
        }
      },
      {
        id: 'openai-2',
        type: 'openai',
        data: {
          promptText: 'Второй вопрос',
          responseText: 'Второй ответ',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'openai-1',
        target: 'openai-2'
      }
    ]

    const result = assembleContext('openai-2', nodes, edges)
    
    // Both dialogues should be included
    assert.ok((result).includes('User: Первый вопрос'))
    assert.ok((result).includes('Assistant: Первый ответ'))
    assert.ok((result).includes('User: Второй вопрос'))
    assert.ok((result).includes('Assistant: Второй ответ'))
  })

  // Test scenario with empty context
  it('должен возвращать пустую строку для узла без контекста', () => {
    const nodes: Node[] = [
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: '',
          responseText: '',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = []

    const result = assembleContext('openai-1', nodes, edges)
    
    assert.equal(result, '')
  })

  // Test scenario with ignorable node types
  it('должен игнорировать notes и включать подпись media узла', () => {
    const nodes: Node[] = [
      {
        id: 'notes-1',
        type: 'notes',
        data: {
          notes: 'Важная заметка',
          hidden: false
        }
      },
      {
        id: 'media-1',
        type: 'media',
        data: {
          url: 'https://example.com/image.jpg',
          caption: 'Описание изображения',
          hidden: false
        }
      },
      {
        id: 'text-1',
        type: 'text',
        data: {
          textContent: 'Важный текст',
          hidden: false
        }
      },
      {
        id: 'openai-1',
        type: 'openai',
        data: {
          promptText: 'Ответь на вопрос',
          hidden: false
        }
      }
    ]

    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'notes-1',
        target: 'openai-1'
      },
      {
        id: 'edge-2',
        source: 'media-1',
        target: 'openai-1'
      },
      {
        id: 'edge-3',
        source: 'text-1',
        target: 'openai-1'
      }
    ]

    const result = assembleContext('openai-1', nodes, edges)
    
    assert.ok(!(result).includes('Важная заметка'))
    assert.ok((result).includes('Caption: Описание изображения'))
    // Text node should be included
    assert.ok((result).includes('Text Input: Важный текст'))
  })
})
